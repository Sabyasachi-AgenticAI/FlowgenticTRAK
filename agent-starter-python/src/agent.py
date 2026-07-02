import asyncio
import contextlib
import json
import logging
import os
import textwrap
from datetime import date, timedelta

import httpx
from dotenv import load_dotenv
from livekit import api, rtc
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    AudioConfig,
    BackgroundAudioPlayer,
    BuiltinAudioClip,
    JobContext,
    JobProcess,
    RunContext,
    cli,
    function_tool,
    get_job_context,
    room_io,
)
from livekit.plugins import ai_coustics, cartesia, deepgram, silero
from livekit.plugins import openai as openai_plugin
from livekit.plugins.turn_detector.multilingual import MultilingualModel

logger = logging.getLogger("agent")
load_dotenv(".env.local")

SUPA_URL = os.getenv("SUPABASE_URL", "")
SUPA_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
LIVEKIT_URL = os.getenv("LIVEKIT_URL", "")

VOICE_ARIA = "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"  # Jacqueline - confident young American female
VOICE_MARCUS = "c0f43c66-9f21-4034-b485-8f1d3340d759"  # Clarkson - Executive Tone, confident businesslike male


# ── Supabase REST helpers ─────────────────────────────────────
def _supa_headers() -> dict:
    return {
        "apikey": SUPA_KEY,
        "Authorization": f"Bearer {SUPA_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


async def _supa_get(table: str, filters: dict | None = None) -> list:
    params = {f"{k}": f"eq.{v}" for k, v in (filters or {}).items()}
    async with httpx.AsyncClient() as c:
        r = await c.get(f"{SUPA_URL}/rest/v1/{table}", headers=_supa_headers(), params=params)
        return r.json() if r.is_success and isinstance(r.json(), list) else []


async def _supa_patch(table: str, match: dict, data: dict) -> list:
    params = {k: f"eq.{v}" for k, v in match.items()}
    async with httpx.AsyncClient() as c:
        r = await c.patch(f"{SUPA_URL}/rest/v1/{table}", headers=_supa_headers(), params=params, json=data)
        return r.json() if r.is_success and isinstance(r.json(), list) else []


async def _supa_post(table: str, data: dict) -> list:
    async with httpx.AsyncClient() as c:
        r = await c.post(f"{SUPA_URL}/rest/v1/{table}", headers=_supa_headers(), json=data)
        return r.json() if r.is_success and isinstance(r.json(), list) else []


# ══════════════════════════════════════════════════════════════
# PERSONA 1 — Load Tender (inbound calls from carriers)
# ══════════════════════════════════════════════════════════════
class LoadTenderAgent(Agent):
    async def on_enter(self) -> None:
        await self.session.generate_reply()

    def __init__(self) -> None:
        super().__init__(
            instructions=textwrap.dedent("""\
                You are Aria, an AI dispatcher for Saturn Freight Systems.
                You handle inbound calls from motor carriers who want to accept open load tenders.

                # Output rules
                You are on a live phone call. Always:
                - Respond in plain spoken English only. No lists, markdown, bullet points, or emojis.
                - Keep replies to one or two sentences. Ask one question at a time.
                - Spell any identifier (ref number, load ID) digit by digit.
                  Example: "LT-001" → "L T — zero zero one". "29472" → "two nine four seven two" (NEVER "twenty-nine thousand").
                - Spell out dollar amounts in full words (e.g. "twelve hundred dollars").
                - Avoid acronyms unless the caller used them first.

                # Voice naturalness
                Sound like a real human dispatcher on the phone, not a text reader.
                - Vary your opener every turn — never start two turns the same way.
                  Examples: "Yeah, got it.", "Sure, let me pull that up.", "Alright —", "Mhm, go ahead."
                - Use natural pauses: "Hmm, <break time="400ms"/> let me check that."
                - Use "um" occasionally and follow with <break time="300ms"/> then a recovery.
                  Example: "I've got, um, <break time="300ms"/> so — load L T zero zero three available."
                - Allow brief self-corrections: "Pickup is Monday — actually, make that Tuesday the twenty-second."
                - When confirming: "Alright, so I have you down for [detail] — does that sound right?"
                - Close warmly: "Great — and have a good rest of your day."

                # Objective
                Identify the load, collect carrier information, and complete the booking.

                # Call flow
                1. Greet warmly. Ask which load they're calling about.
                2. Use lookup_open_loads if they don't have a reference number.
                3. Confirm the load details out loud: origin, destination, pickup date.
                4. Collect: carrier company name, MC or DOT number, driver full name, driver cell.
                5. Confirm the agreed rate.
                6. Call book_load to record the booking.
                7. Give a verbal confirmation number and let them know the rate confirmation
                   will be sent by email. Thank them and close.

                # Guardrails
                - If anything is unclear, ask once and wait — don't guess.
                - Stay on topic — load booking only.
            """),
        )

    @function_tool
    async def lookup_open_loads(self, context: RunContext) -> str:
        """Look up open load tenders available for booking.
        Use when the caller does not have a reference number.
        """
        rows = await _supa_get("demo_loads", {"status": "new"})
        if not rows:
            return "No open loads available right now."
        lines = [
            f"Ref {r.get('ref', '?')}: "
            f"{r.get('shipper', '?')} — {r.get('route', '?')} — {r.get('service', '?')}"
            for r in rows[:5]
        ]
        return "Open loads: " + "; ".join(lines)

    @function_tool
    async def book_load(
        self,
        context: RunContext,
        ref: str,
        carrier: str,
        driver: str,
        phone: str,
    ) -> str:
        """Book a load tender and record the carrier assignment.

        Args:
            ref: Load reference number (e.g. 'LT-001')
            carrier: Carrier company name
            driver: Driver's full name
            phone: Driver's cell phone number
        """
        logger.info("Booking load %s for %s / driver %s", ref, carrier, driver)
        result = await _supa_patch(
            "demo_loads",
            {"ref": ref},
            {"status": "act", "created_by": "aria"},
        )
        if result:
            return (
                f"Load {ref} is now booked for {carrier}. "
                f"Driver {driver} is confirmed. "
                f"The rate confirmation will go out by email shortly."
            )
        return (
            f"I couldn't find load {ref} in our system. "
            f"Could you double-check the reference number?"
        )


# ══════════════════════════════════════════════════════════════
# PERSONA 2 — Track & Trace / Carrier Check (outbound)
# ══════════════════════════════════════════════════════════════
class CarrierCheckAgent(Agent):
    def __init__(self, driver_meta: dict | None = None) -> None:
        meta = driver_meta or {}
        self.driver_name = meta.get("driver_name", "the driver")
        ref = meta.get("ref", "your load")
        route = meta.get("route", "")
        gps_idle_mins = int(meta.get("gps_idle_mins", 30))
        alert_type = str(meta.get("alert_type", "gps_idle"))

        if "breakdown" in alert_type or "vehicle" in alert_type:
            situation = (
                f"GPS has been idle for {gps_idle_mins} minutes AND "
                f"a driver-initiated VEHICLE BREAKDOWN alert was received. This is a priority call."
            )
            opening = (
                f"Ask about their safety first, then the vehicle condition, "
                f"then whether roadside assistance is needed."
            )
        else:
            situation = (
                f"GPS tracking shows the truck has been stationary for {gps_idle_mins} minutes "
                f"with no movement logged."
            )
            opening = f"Check their status, confirm current location, and get an updated ETA."

        super().__init__(
            instructions=textwrap.dedent(f"""\
                You are Aria, an AI logistics assistant for Saturn Freight Systems.
                You are making an outbound check-in call to {self.driver_name} about load {ref} ({route}).

                # Why you are calling
                {situation}
                {opening}

                # Output rules
                You are on a live phone call. Drivers may be in difficult situations — be clear and concise.
                - SSML break tags and plain text only. No markdown, lists, bullet points, or symbols.
                - One question at a time. Maximum two sentences per turn.
                - Spell any identifier (ref number, load ID) digit by digit.
                  Example: "REF-29472" → "R E F — two nine four seven two" (NEVER "twenty-nine thousand").
                - Say times naturally (e.g. "two-thirty P M Central").

                # Pauses and filler words
                Use filler words with SSML break tags so your speech sounds natural, not scripted.
                After standalone "um", insert <break time="300ms"/> and follow with "so" or "let me."

                Examples:
                - Bad:  "I'll note that down."
                - Good: "Okay, um <break time="300ms"/> so let me get that noted."
                - Bad:  "What is your current location?"
                - Good: "And where are you right now — um <break time="200ms"/> like the nearest town or highway?"
                - Bad:  "I understand, there is a delay."
                - Good: "Right, <break time="150ms"/> I hear you — so we're looking at a delay then."

                # Self-corrections
                When a better phrasing comes to mind mid-sentence, drop the first and restart naturally. Never apologize for it.

                Examples:
                - Bad:  "What is your estimated time of arrival?"
                - Good: "And when do you think you'll — actually, <break time="200ms"/> what's your ETA looking like right now?"
                - Bad:  "Are there any issues with the load?"
                - Good: "Is everything okay with the — well, <break time="150ms"/> any issues I should flag for the team?"

                # Phrase variation
                Never open two consecutive turns with the same word. Rotate naturally:
                "Got it!", "Okay.", "I see.", "Right, right.", "Understood.", "Alright.",
                "And that's helpful.", "Good to know.", "Copy that.", "Noted."

                # Non-verbal sounds
                Use sparingly — at most once per call:
                - If the driver shares something serious (breakdown, injury), a warm "Oh gosh, okay." before responding.
                - If the driver says they're busy or in traffic, a quick "Of course, of course." before asking to be brief.

                # Call flow
                1. Open with ONLY: "Hi, is this {self.driver_name}?" — stop and wait for their reply.
                   Do NOT say anything else until they respond.
                2. Once confirmed: "Hi, I'm calling from Saturn Freight Systems about load {ref}."
                   Then immediately state WHY in one sentence (draw from the situation above).
                3. Listen and ask follow-up questions based on what they tell you.
                4. Collect: current location, ETA or situation status, any issues.
                5. Call update_carrier_status once you have all needed information.
                   ALWAYS populate call_summary with a one-sentence recap of the call outcome.
                6. Do NOT say goodbye — it plays automatically after the tool succeeds. Stay silent.

                # Guardrails
                - Ask one question at a time.
                - If no answer after a reasonable wait, note it and call update_carrier_status anyway.
                - Do not speak after calling update_carrier_status.
            """),
        )

    async def on_enter(self) -> None:
        await self.session.generate_reply()

    async def _hangup(self) -> None:
        job_ctx = get_job_context()
        await job_ctx.api.room.delete_room(
            api.DeleteRoomRequest(room=job_ctx.room.name)
        )

    @function_tool
    async def get_active_loads(self, context: RunContext) -> str:
        """Get the list of carrier loads that need a check-in call.
        Use this at the start of the call to know which load to reference.
        """
        rows = await _supa_get("carrier_check_loads", {"call_status": "in_progress"})
        if not rows:
            rows = await _supa_get("carrier_check_loads")
        if not rows:
            return "No active loads found."
        lines = [
            f"Ref {r.get('ref', '?')}: "
            f"{r.get('carrier', '?')} — {r.get('route', r.get('origin', '?') + ' to ' + r.get('destination', '?'))}"
            f" — pickup {r.get('pickup_time', '?')}"
            for r in rows[:3]
        ]
        return "Active loads: " + "; ".join(lines)

    @function_tool
    async def update_carrier_status(
        self,
        context: RunContext,
        ref: str,
        location: str,
        eta: str,
        call_summary: str,
        status: str = "confirmed",
        notes: str = "",
    ) -> str:
        """Update carrier location, ETA, and status. Call once all details are collected.
        The call ends automatically after this tool — do NOT speak again.

        Args:
            ref: Load reference number
            location: Driver's current location (city and state)
            eta: Estimated arrival time (e.g. '2:30 PM Eastern')
            call_summary: One-sentence recap of the call outcome for the dispatch dashboard (REQUIRED)
            status: One of 'confirmed', 'delayed', or 'issue_raised'
            notes: Optional notes about delays or problems
        """
        logger.info("Carrier status update — %s: %s, ETA %s (%s)", ref, location, eta, status)
        data: dict = {
            "call_status": "completed",
            "status": status,
            "last_location": location,
            "last_eta": eta,
            "call_summary": call_summary,
        }
        if notes:
            data["notes"] = notes
        result = await _supa_patch("carrier_check_loads", {"ref": ref}, data)
        if not result:
            return f"I couldn't find load {ref}. Could you read back the reference number?"
        farewell = context.session.say(
            f"Perfect — I've got everything noted. "
            f"You take care out there {self.driver_name}, "
            f"and give us a call if anything changes. Goodbye!",
            allow_interruptions=False,
        )
        await farewell.wait_for_playout()
        await asyncio.sleep(0.5)
        await self._hangup()


# ══════════════════════════════════════════════════════════════
# PERSONA 3 — AR Collections (outbound)
# ══════════════════════════════════════════════════════════════
class ARCollectionsAgent(Agent):
    def __init__(self, account_meta: dict | None = None) -> None:
        meta = account_meta or {}
        self.contact_name = meta.get("contact_name") or "the billing contact"
        self.customer = meta.get("customer", "your company")
        invoice_no = meta.get("invoice_no", "your invoice")
        amount_due = meta.get("amount_due", 0)
        due_date = meta.get("due_date", "recently")
        days_overdue = int(meta.get("days_overdue", 0))
        amount_str = f"${amount_due:,.0f}" if amount_due else "the outstanding amount"
        today = date.today()
        today_str = today.strftime("%B %d, %Y")
        tomorrow_str = (today + timedelta(days=1)).strftime("%B %d, %Y")

        super().__init__(
            instructions=textwrap.dedent(f"""\
                You are Aria, an AI accounts receivable specialist for Saturn Freight Systems.
                You are making an outbound collection call to {self.customer} about an overdue invoice.

                # Account details — use these directly, do not look them up
                Contact: {self.contact_name} (Accounts Payable)
                Invoice: {invoice_no}
                Amount due: {amount_str}
                Due date: {due_date}
                Days overdue: {days_overdue}
                Today's date: {today_str}

                # Resolving relative dates
                When the contact gives a relative date, resolve it to the actual calendar date before calling any tool.
                - "tomorrow" → {tomorrow_str}
                - "next week" → the week starting {(today + timedelta(days=7)).strftime("%B %d, %Y")}
                - "end of month" → {today.strftime("%B")} {(date(today.year, today.month % 12 + 1, 1) - timedelta(days=1)).day}, {today.year}
                - "Friday" / "Monday" etc. → calculate the nearest upcoming weekday
                Never ask for clarification on a date the contact has already stated clearly.

                # Output rules
                You are on a live phone call. Apply these rules at all times:
                - SSML break tags and plain text only. No markdown, lists, bullet points, or symbols.
                - One to two sentences per turn. Ask one question at a time.
                - Spell any identifier (invoice number, reference) digit by digit.
                  Example: "INV-4821" → "I N V — four eight two one" (NEVER "four thousand eight hundred").
                - Spell out dollar amounts in full words (e.g. "twelve thousand four hundred dollars").
                - Spell out dates fully (e.g. "June twenty-fifth, twenty twenty-six").

                # Pauses and filler words
                Use filler words with SSML break tags so your speech sounds natural, not scripted.
                After standalone "um", insert <break time="300ms"/> and follow with "so" or "let me."

                Examples:
                - Bad:  "I'll note that down."
                - Good: "Okay, um <break time="300ms"/> so let me get that noted."
                - Bad:  "When can we expect payment?"
                - Good: "And when are you thinking — um <break time="200ms"/> like, what date works for your team?"
                - Bad:  "I understand there may be a delay."
                - Good: "Right, <break time="150ms"/> I hear you — so there's a timing issue then."

                # Self-corrections
                When a better phrasing comes to mind mid-sentence, drop the first and restart naturally. Never apologize for it.

                Examples:
                - Bad:  "The invoice was due on {due_date}."
                - Good: "So this was due — the due date was {due_date}, that is."
                - Bad:  "Are you aware of this balance?"
                - Good: "Did you — have you seen this invoice come through on your end?"

                # Phrase variation
                Never open two consecutive turns with the same word. Rotate naturally:
                "Got it.", "Okay.", "I see.", "Right, right.", "Understood.", "Alright.",
                "And that's helpful.", "Good to know.", "Copy that.", "Noted."

                # Non-verbal sounds
                Use sparingly — at most once per call:
                - If they mention cash flow issues, a warm "Oh, I hear you." before responding.
                - If they're cooperative and quick, a quick "Perfect, perfect." before confirming.

                # Objective
                Secure a payment commitment date, or escalate disputes to a human specialist.
                Be direct about the amount owed — don't soften the ask. Professional and empathetic, never aggressive.

                # Call flow
                1. Open with ONLY: "Hi, may I speak with {self.contact_name} in Accounts Payable?" — stop and wait.
                   Do NOT say anything else until they respond.
                2. Once confirmed: "Hi, this is Aria calling from Saturn Freight Systems.
                   I'm reaching out about invoice {invoice_no} for {amount_str} — it's {days_overdue} days past due."
                3. Ask: "Are you aware of this balance, and do you know when we might expect payment?"
                4. If committing to a date: confirm clearly, then call log_promise_to_pay.
                5. If disputing or unable to commit: call escalate_account.
                6. Do NOT say goodbye — it plays automatically after the tool succeeds. Stay silent.

                # Guardrails
                - One question at a time.
                - If no answer after a reasonable wait, call escalate_account anyway.
                - Do not speak after calling log_promise_to_pay or escalate_account.
            """),
        )

    async def on_enter(self) -> None:
        await self.session.generate_reply()

    async def _hangup(self) -> None:
        job_ctx = get_job_context()
        await job_ctx.api.room.delete_room(
            api.DeleteRoomRequest(room=job_ctx.room.name)
        )

    @function_tool
    async def log_promise_to_pay(
        self,
        context: RunContext,
        invoice_no: str,
        promise_date: str,
        call_summary: str,
        notes: str = "",
    ) -> str:
        """Record a customer's verbal commitment to pay. Call once commitment is confirmed.
        The call ends automatically after this — do NOT speak again.

        Args:
            invoice_no: The invoice number
            promise_date: The date they committed to pay (e.g. 'July 10, 2026')
            call_summary: One-sentence recap for the AR dashboard (REQUIRED)
            notes: Any additional context from the call
        """
        logger.info("Promise to pay — invoice %s by %s", invoice_no, promise_date)
        data: dict = {
            "status": "payment_promised",
            "call_status": "completed",
            "payment_date": promise_date,
            "call_summary": call_summary,
        }
        if notes:
            data["notes"] = notes
        result = await _supa_patch("ar_accounts", {"invoice_no": invoice_no}, data)
        if not result:
            return f"I couldn't find invoice {invoice_no} in our system."
        farewell = context.session.say(
            f"Perfect — that's noted, and we appreciate you working with us on this. "
            f'<break time="300ms"/> Take care, {self.contact_name}. '
            f'<break time="400ms"/> Goodbye!',
            allow_interruptions=False,
        )
        await farewell.wait_for_playout()
        await asyncio.sleep(0.5)
        await self._hangup()

    @function_tool
    async def escalate_account(
        self,
        context: RunContext,
        invoice_no: str,
        reason: str,
        call_summary: str,
    ) -> str:
        """Escalate an account to a human collections specialist.
        Use when the customer disputes charges or cannot commit to a payment date.
        The call ends automatically after this — do NOT speak again.

        Args:
            invoice_no: The invoice number
            reason: Reason for escalation (e.g. 'customer disputes freight charges')
            call_summary: One-sentence recap for the AR dashboard (REQUIRED)
        """
        logger.info("Escalating invoice %s: %s", invoice_no, reason)
        result = await _supa_patch(
            "ar_accounts",
            {"invoice_no": invoice_no},
            {"status": "escalated", "call_status": "completed", "notes": reason, "call_summary": call_summary},
        )
        if not result:
            return f"I couldn't find invoice {invoice_no} in our system."
        farewell = context.session.say(
            f"Of course — I'll flag this for our collections team and someone will be in touch. "
            f'<break time="300ms"/> Thanks for your time, {self.contact_name}. '
            f'<break time="400ms"/> Goodbye!',
            allow_interruptions=False,
        )
        await farewell.wait_for_playout()
        await asyncio.sleep(0.5)
        await self._hangup()

    @function_tool
    async def get_overdue_accounts(self, context: RunContext) -> str:
        """Emergency fallback: fetch overdue account details if not available at call start.
        Only use if account details were not provided.
        """
        rows = await _supa_get("ar_accounts", {"call_status": "in_progress"})
        if not rows:
            rows = await _supa_get("ar_accounts", {"status": "pending_call"})
        if not rows:
            return "No pending accounts found."
        r = sorted(rows, key=lambda x: x.get("days_overdue", 0), reverse=True)[0]
        return (
            f"Invoice {r.get('invoice_no')}: {r.get('customer')} — "
            f"${r.get('amount_due', 0):,.0f} — {r.get('days_overdue', 0)} days overdue — "
            f"due {r.get('due_date', '?')} — contact: {r.get('contact_name') or 'Accounts Payable'}"
        )


# ── Private supervisor consult (used by RateNegotiationAgent) ──
class _BossConsultAgent(Agent):
    """Runs in a private consult room with the supervisor only.
    The carrier is on hold in a different room and never hears this."""

    def __init__(self, deal_summary: str, decision: asyncio.Future) -> None:
        self._decision = decision
        super().__init__(
            instructions=textwrap.dedent(f"""\
                You are Marcus, calling your supervisor privately to get sign-off on a carrier
                rate. This is an internal call — the carrier cannot hear any of this.

                # The deal
                {deal_summary}

                # Output rules
                Brief and direct. One or two sentences per turn. No markdown or symbols.

                # Call flow
                1. Open with ONLY: "Hey, quick one for you." Then state the deal in one sentence
                   and ask: "Do I have your approval at this rate?"
                2. If they approve — at the carrier's number or a different number they'll
                   accept — call approve_rate with that final number.
                3. If they reject outright, call reject_rate with their reason.
                4. Do not speak after calling approve_rate or reject_rate.

                # Guardrails
                - Only talk to the supervisor — never mention the carrier.
                - If there's no clear answer after a reasonable back-and-forth, ask once more
                  directly, then call reject_rate with reason "no clear decision" rather than guessing.
            """),
        )
        # No on_enter auto-greeting here — the supervisor hasn't picked up yet when this
        # session starts. call_boss_for_approval triggers the greeting once they answer.

    @function_tool
    async def approve_rate(self, context: RunContext, final_rate: float, notes: str = "") -> str:
        """Record supervisor approval for the rate. Call once they've clearly said yes.

        Args:
            final_rate: The rate the supervisor approved (may differ from the carrier's ask)
            notes: Any conditions or notes from the supervisor
        """
        if not self._decision.done():
            self._decision.set_result(("approved", final_rate, notes))
        farewell = context.session.say("Perfect, thanks — talk soon.", allow_interruptions=False)
        await farewell.wait_for_playout()
        return "Approval recorded."

    @function_tool
    async def reject_rate(self, context: RunContext, reason: str) -> str:
        """Record supervisor rejection. Call if they decline the rate.

        Args:
            reason: Why the supervisor rejected it
        """
        if not self._decision.done():
            self._decision.set_result(("rejected", None, reason))
        farewell = context.session.say("Understood, thanks.", allow_interruptions=False)
        await farewell.wait_for_playout()
        return "Rejection recorded."


# ══════════════════════════════════════════════════════════════
# PERSONA 4 — Rate Negotiation (outbound, Marcus)
# ══════════════════════════════════════════════════════════════
class RateNegotiationAgent(Agent):
    def __init__(self, negotiation_meta: dict | None = None) -> None:
        meta = negotiation_meta or {}
        self.negotiation_id = meta.get("negotiation_id")
        self.origin = meta.get("origin", "origin")
        self.destination = meta.get("destination", "destination")
        self.weight_lbs = int(meta.get("weight_lbs") or 0)
        self.commodity = meta.get("commodity", "general freight")
        self.carrier_name = meta.get("carrier_name", "the carrier")
        self.floor_rate = float(meta.get("floor_rate") or 0)
        self.target_rate = float(meta.get("target_rate") or 0)
        self.ceiling_rate = float(meta.get("ceiling_rate") or 0)
        self.boss_called = False

        load_ref = meta.get("load_ref", "")
        pickup_address = meta.get("pickup_address", "")
        delivery_address = meta.get("delivery_address", "")
        pickup_time = meta.get("pickup_time", "")
        delivery_time = meta.get("delivery_time", "")
        detention_terms = meta.get("detention_terms") or "$75/hour after 2 free hours at pickup and delivery"
        quick_pay_pct = meta.get("quick_pay_pct")
        self.call_list_position = meta.get("call_list_position")
        self.call_list_total = meta.get("call_list_total")

        weight_str = f"{self.weight_lbs:,} lbs" if self.weight_lbs else "full truckload"

        load_lines = []
        if load_ref:
            load_lines.append(f"Load ref: {load_ref}")
        load_lines.append(f"Lane: {self.origin} → {self.destination}")
        load_lines.append(f"Weight: {weight_str}")
        load_lines.append(f"Commodity: {self.commodity}")
        if pickup_address:
            load_lines.append(f"Pickup: {pickup_address}" + (f" — {pickup_time}" if pickup_time else ""))
        if delivery_address:
            load_lines.append(f"Delivery: {delivery_address}" + (f" — {delivery_time}" if delivery_time else ""))
        load_lines.append(f"Detention terms: {detention_terms}")
        if quick_pay_pct:
            load_lines.append(f"Quick pay available at {quick_pay_pct}% if the carrier asks about payment speed")
        load_block = "\n                ".join(load_lines)

        call_list_line = ""
        if self.call_list_position and self.call_list_total:
            call_list_line = (
                f"\n                This is carrier {self.call_list_position} of "
                f"{self.call_list_total} on this load's call list — others already declined.\n"
            )

        super().__init__(
            instructions=textwrap.dedent(f"""\
                You are Marcus, a freight rate negotiation specialist at Saturn Freight Systems.
                You are making an outbound call to {self.carrier_name} to negotiate a spot rate.
                {call_list_line}
                # Load details
                {load_block}

                # Rate corridor — CONFIDENTIAL, never reveal these to the carrier
                Floor (absolute minimum we pay): ${self.floor_rate:,.0f}
                Target (your goal):              ${self.target_rate:,.0f}
                Ceiling (max you can authorise): ${self.ceiling_rate:,.0f}

                # Negotiation strategy
                - Open by stating the lane and weight only. Never mention floor, target, or ceiling.
                - First ask: "What's your best rate on this?"
                - Carrier AT or BELOW target → it's a good deal; still call call_boss_for_approval before committing.
                - Carrier BETWEEN target and ceiling → push back once with a counter near target, then call call_boss_for_approval with their firm offer.
                - Carrier ABOVE ceiling → counter firmly at target. If they won't move below ceiling, call reject_negotiation.
                - Never accept a rate on the spot — procedure requires supervisor sign-off every time.
                - Be confident and direct. You have done hundreds of these calls.

                # Persuasion tactics
                If the carrier hesitates, pushes back on rate, mentions fuel costs, gives a tough
                final counter, or acts like a tough negotiator, call get_persuasion_tactic with the
                matching trigger before responding:
                carrier_hesitating, carrier_above_ceiling, carrier_mentions_fuel,
                carrier_mentions_concerns, carrier_final_counter, carrier_tough_negotiator,
                owner_operator_tough.
                Weave the returned angle into your own words naturally — never read it verbatim,
                and don't call it more than once or twice per call.

                # Output rules
                - Phone call tone: brief, direct, commercial. Two sentences max per turn.
                - SSML break tags for natural pauses. No markdown or symbols.
                - Speak dollar amounts in full words: "two thousand nine hundred dollars".
                - Do NOT say goodbye — it plays automatically after the tool completes.

                # Naturalism
                After "yeah" or "right": insert <break time="200ms"/> before continuing.
                Examples:
                - "Right, <break time="200ms"/> so we're at two thousand nine hundred for this lane."
                - "Yeah, <break time="150ms"/> let me see what I can do on that."

                # Call flow
                1. Open: "Hey, this is Marcus from Saturn Freight — you got capacity available right now?"
                2. State: "{self.origin} to {self.destination}, {weight_str}, {self.commodity} — what's your best rate?"
                3. Negotiate and counter until carrier gives a firm number. Use get_persuasion_tactic
                   when they push back (see above).
                4. Call call_boss_for_approval with that number. The carrier is placed on hold
                   automatically while you consult the supervisor privately — they cannot hear that call.
                   Say something like "Let me check on that — one moment" right before calling it.
                5. When call_boss_for_approval returns, you'll be back with the carrier and know the
                   supervisor's decision. Continue the conversation from there.
                6. If approved: confirm the carrier's MC number and that their insurance is current,
                   then get the driver's full name and cell number who will run this load.
                7. Call confirm_rate with all of that, or reject_negotiation if rejected.

                # Guardrails
                - One question per turn.
                - Never reveal floor / target / ceiling.
                - Always call boss before committing — no exceptions.
                - Do not speak after confirm_rate or reject_negotiation.
            """),
        )

    async def on_enter(self) -> None:
        await self.session.generate_reply()

    async def _hangup(self) -> None:
        job_ctx = get_job_context()
        await job_ctx.api.room.delete_room(
            api.DeleteRoomRequest(room=job_ctx.room.name)
        )

    @function_tool
    async def get_persuasion_tactic(self, context: RunContext, trigger: str) -> str:
        """Look up a persuasion tactic for a specific carrier pushback or hesitation.

        Args:
            trigger: One of carrier_hesitating, carrier_above_ceiling, carrier_mentions_fuel,
                carrier_mentions_concerns, carrier_final_counter, carrier_tough_negotiator,
                owner_operator_tough — matching what the carrier just said
        """
        rows = await _supa_get("persuasion_playbook", {"trigger": trigger})
        if not rows:
            return "No specific tactic on file — use your own judgment and stay within the rate corridor."
        rows.sort(key=lambda r: r.get("effectiveness") or 0, reverse=True)
        lines = [f"- {r['name']}: {(r.get('script_line') or '').strip()}" for r in rows[:2]]
        return "Persuasion angles you can adapt in your own words (don't read verbatim):\n" + "\n".join(lines)

    @function_tool
    async def call_boss_for_approval(
        self,
        context: RunContext,
        carrier_rate: float,
        justification: str,
    ) -> str:
        """Call the supervisor privately for rate approval. Always call this before committing
        to any rate. The carrier is placed on hold and cannot hear this consult — you'll return
        to them automatically once the supervisor decides.

        Args:
            carrier_rate: The carrier's offered rate as a number (e.g. 3050)
            justification: One sentence on why this rate is acceptable or questionable
        """
        if self.boss_called:
            return "Supervisor already contacted. Act on their decision."
        self.boss_called = True

        job_ctx = get_job_context()
        sip_trunk_id = os.getenv("SIP_OUTBOUND_TRUNK_ID", "")
        boss_phone = os.getenv("BOSS_PHONE", "")

        await _supa_patch(
            "rate_negotiations",
            {"id": self.negotiation_id},
            {"carrier_offer": carrier_rate, "boss_call_status": "calling", "status": "pending_approval"},
        )

        # Hold the carrier — they can't hear or be heard during the supervisor consult.
        context.session.input.set_audio_enabled(False)
        context.session.output.set_audio_enabled(False)

        consult_room_name = f"{job_ctx.room.name}-consult"
        consult_room = rtc.Room()
        decision: asyncio.Future = asyncio.get_running_loop().create_future()
        consult_session: AgentSession | None = None

        try:
            token = (
                api.AccessToken()
                .with_identity("boss-consult-agent")
                .with_grants(
                    api.VideoGrants(
                        room_join=True,
                        room=consult_room_name,
                        can_publish=True,
                        can_subscribe=True,
                    )
                )
                .to_jwt()
            )
            await consult_room.connect(LIVEKIT_URL, token)

            consult_session = AgentSession(
                llm=openai_plugin.LLM(model="gpt-4o-mini"),
                stt=deepgram.STT(model="nova-3-general", language="en"),
                tts=cartesia.TTS(
                    model="sonic-3",
                    voice=VOICE_MARCUS,
                ),
                vad=job_ctx.proc.userdata["vad"],
            )
            deal_summary = (
                f"{self.carrier_name} is quoting ${carrier_rate:,.0f} for {self.origin} to "
                f"{self.destination}, {self.weight_lbs:,} lbs {self.commodity}. {justification}."
            )
            await consult_session.start(
                agent=_BossConsultAgent(deal_summary, decision),
                room=consult_room,
            )

            await job_ctx.api.sip.create_sip_participant(
                api.CreateSIPParticipantRequest(
                    sip_trunk_id=sip_trunk_id,
                    sip_call_to=boss_phone,
                    room_name=consult_room_name,
                    participant_identity="boss-approval",
                    participant_name="Supervisor",
                    play_dialtone=True,
                    wait_until_answered=True,
                )
            )
            await _supa_patch(
                "rate_negotiations",
                {"id": self.negotiation_id},
                {"boss_call_status": "on_call"},
            )

            # Supervisor has picked up — safe to greet them now.
            await consult_session.generate_reply()

            outcome, final_rate, notes = await asyncio.wait_for(decision, timeout=180)
        except Exception as e:
            logger.error("Boss consult failed: %s", e)
            await _supa_patch(
                "rate_negotiations",
                {"id": self.negotiation_id},
                {"boss_call_status": "failed"},
            )
            context.session.input.set_audio_enabled(True)
            context.session.output.set_audio_enabled(True)
            return "Could not reach supervisor. Use your best judgment and proceed."
        finally:
            if consult_session is not None:
                await consult_session.aclose()
            await consult_room.disconnect()
            with contextlib.suppress(Exception):
                await job_ctx.api.room.delete_room(api.DeleteRoomRequest(room=consult_room_name))

        # Resume the carrier call.
        context.session.input.set_audio_enabled(True)
        context.session.output.set_audio_enabled(True)

        await _supa_patch(
            "rate_negotiations",
            {"id": self.negotiation_id},
            {"boss_call_status": "completed", "boss_decision": outcome},
        )

        if outcome == "approved":
            return (
                f"Supervisor approved at ${final_rate:,.0f}. "
                f"Confirm the deal with the carrier now by calling confirm_rate."
            )
        return (
            f"Supervisor rejected the rate. Reason: {notes}. "
            f"Tell the carrier you can't make the numbers work, or counter once more if appropriate, "
            f"then call reject_negotiation if there's no deal."
        )

    @function_tool
    async def confirm_rate(
        self,
        context: RunContext,
        final_rate: float,
        mc_number: str,
        driver_name: str,
        driver_phone: str,
        call_summary: str,
        insurance_verified: bool = True,
    ) -> str:
        """Lock in the negotiated rate after supervisor approval. Confirm the carrier's MC
        number and current insurance verbally, and get the driver's name and cell number,
        before calling this.

        Args:
            final_rate: The agreed final rate
            mc_number: Carrier's MC number as stated on the call
            driver_name: Full name of the driver who will run this load
            driver_phone: Driver's cell phone number
            call_summary: One-sentence recap for the dashboard (REQUIRED)
            insurance_verified: Whether the carrier confirmed current insurance coverage
        """
        await _supa_patch(
            "rate_negotiations",
            {"id": self.negotiation_id},
            {
                "final_rate": final_rate,
                "status": "completed",
                "call_summary": call_summary,
                "boss_decision": "approved",
                "mc_number": mc_number,
                "driver_name": driver_name,
                "driver_phone": driver_phone,
                "insurance_verified": insurance_verified,
            },
        )
        farewell = context.session.say(
            f"Perfect — we are locked in at {int(final_rate):,} dollars. "
            f'<break time="300ms"/> I will get the rate confirmation over to you shortly. '
            f'<break time="300ms"/> Thanks for working with us. <break time="400ms"/> Goodbye!',
            allow_interruptions=False,
        )
        await farewell.wait_for_playout()
        await asyncio.sleep(0.5)
        await self._hangup()
        return "Rate confirmed."

    @function_tool
    async def reject_negotiation(
        self,
        context: RunContext,
        reason: str,
        call_summary: str,
    ) -> str:
        """End the negotiation without a deal — rate above ceiling or supervisor rejected.

        Args:
            reason: Why the negotiation failed
            call_summary: One-sentence recap for the dashboard (REQUIRED)
        """
        await _supa_patch(
            "rate_negotiations",
            {"id": self.negotiation_id},
            {
                "status": "failed",
                "call_summary": call_summary,
                "boss_decision": "rejected",
                "notes": reason,
            },
        )
        farewell = context.session.say(
            f"I appreciate your time — we are not able to make the numbers work on this one. "
            f'<break time="300ms"/> We will keep you in mind for future loads. <break time="400ms"/> Goodbye!',
            allow_interruptions=False,
        )
        await farewell.wait_for_playout()
        await asyncio.sleep(0.5)
        await self._hangup()
        return "Negotiation closed."


# ── Persona factory ───────────────────────────────────────────
_PERSONA_MAP: dict[str, type[Agent]] = {
    "load_tender": LoadTenderAgent,
    "carrier_check": CarrierCheckAgent,
    "ar_collections": ARCollectionsAgent,
    "rate_negotiation": RateNegotiationAgent,
}


def _resolve_dispatch(room_name: str, metadata_str: str | None) -> tuple[str, dict]:
    """Determine use case and extract metadata from dispatch."""
    driver_meta: dict = {}
    if metadata_str:
        try:
            parsed = json.loads(metadata_str)
            use_case = parsed.get("use_case", "")
            driver_meta = {k: v for k, v in parsed.items() if k != "use_case"}
            if use_case and use_case in _PERSONA_MAP:
                return use_case, driver_meta
        except (json.JSONDecodeError, AttributeError):
            pass
    prefix_map = {
        "lt": "load_tender", "crew": "load_tender",
        "cc": "carrier_check", "ar": "ar_collections",
        "rn": "rate_negotiation",
    }
    prefix = room_name.split("-")[0] if room_name else "lt"
    return prefix_map.get(prefix, "load_tender"), driver_meta


# ── Agent server setup ────────────────────────────────────────
server = AgentServer()


def prewarm(proc: JobProcess):
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


@server.rtc_session(agent_name="my-agent")
async def my_agent(ctx: JobContext):
    ctx.log_context_fields = {"room": ctx.room.name}

    metadata_str = getattr(getattr(ctx, "job", None), "metadata", None)
    use_case, driver_meta = _resolve_dispatch(ctx.room.name, metadata_str)
    logger.info("Room %s → use_case=%s driver=%s", ctx.room.name, use_case, driver_meta.get("driver_name"))

    session = AgentSession(
        llm=openai_plugin.LLM(model="gpt-4o-mini"),
        stt=deepgram.STT(model="nova-3-general", language="en"),
        tts=cartesia.TTS(
            model="sonic-3",
            voice=VOICE_MARCUS if use_case == "rate_negotiation" else VOICE_ARIA,
        ),
        turn_detection=MultilingualModel(),
        vad=ctx.proc.userdata["vad"],
        preemptive_generation=True,
    )

    if use_case == "carrier_check":
        agent = CarrierCheckAgent(driver_meta=driver_meta)
    elif use_case == "ar_collections":
        pending = await _supa_get("ar_accounts", {"status": "pending_call"})
        pending = sorted(pending, key=lambda r: r.get("days_overdue", 0), reverse=True)
        if pending:
            account = pending[0]
            await _supa_patch("ar_accounts", {"id": account["id"]}, {"call_status": "in_progress"})
            agent = ARCollectionsAgent(account_meta=account)
        else:
            agent = ARCollectionsAgent()
    elif use_case == "rate_negotiation":
        if driver_meta.get("negotiation_id"):
            await _supa_patch(
                "rate_negotiations",
                {"id": driver_meta["negotiation_id"]},
                {"status": "negotiating"},
            )
        agent = RateNegotiationAgent(negotiation_meta=driver_meta)
    else:
        agent = _PERSONA_MAP[use_case]()
    logger.info("Starting session with %s", type(agent).__name__)

    # Office ambience loops throughout; keyboard typing plays while Aria thinks
    background_audio = BackgroundAudioPlayer(
        ambient_sound=AudioConfig(BuiltinAudioClip.OFFICE_AMBIENCE, volume=0.6),
        thinking_sound=[
            AudioConfig(BuiltinAudioClip.KEYBOARD_TYPING, volume=0.5, probability=0.7),
            AudioConfig(BuiltinAudioClip.KEYBOARD_TYPING2, volume=0.4, probability=0.3),
        ],
    )

    session_task = asyncio.create_task(
        session.start(
            agent=agent,
            room=ctx.room,
            room_options=room_io.RoomOptions(
                audio_input=room_io.AudioInputOptions(
                    noise_cancellation=ai_coustics.audio_enhancement(
                        model=ai_coustics.EnhancerModel.QUAIL_VF_S
                    ),
                ),
            ),
        )
    )
    await ctx.connect()
    await background_audio.start(room=ctx.room, agent_session=session)
    await session_task


if __name__ == "__main__":
    cli.run_app(server)
