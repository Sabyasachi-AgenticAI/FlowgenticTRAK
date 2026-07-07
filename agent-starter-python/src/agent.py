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
    ToolError,
    cli,
    function_tool,
    get_job_context,
    room_io,
)
from livekit.agents.beta.workflows import WarmTransferTask
from livekit.plugins import ai_coustics, cartesia, deepgram, silero
from livekit.plugins import openai as openai_plugin
from livekit.plugins.turn_detector.multilingual import MultilingualModel

logger = logging.getLogger("agent")
load_dotenv(".env.local")

SUPA_URL = os.getenv("SUPABASE_URL", "")
SUPA_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
LIVEKIT_URL = os.getenv("LIVEKIT_URL", "")

VOICE_ARIA = "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc"  # Jacqueline - confident young American female
VOICE_MARCUS = "5fc5c797-12c5-4f2b-ac9b-d4e53c08098f"  # Wyatt - Dependable Dispatcher, friendly American male w/ subtle Southern drawl
MARCUS_TTS_SPEED = 1.15  # sonic-3 requires a float (0.6-2.0), not the "fast"/"slow" string literals
MARCUS_TTS_EMOTION = ["Confident"]


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
                  The hyphen is a brief pause, not a spoken word — never say "dash" or "hyphen" out loud.
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
                "Ask about their safety first, then the vehicle condition, "
                "then whether roadside assistance is needed."
            )
        else:
            situation = (
                f"GPS tracking shows the truck has been stationary for {gps_idle_mins} minutes "
                f"with no movement logged."
            )
            opening = "Check their status, confirm current location, and get an updated ETA."

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
                  The hyphen is a brief pause, not a spoken word — never say "dash" or "hyphen" out loud.
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
                  The hyphen is a brief pause, not a spoken word — never say "dash" or "hyphen" out loud.
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

                # If asked whether you're an AI, a bot, or a real person
                Answer immediately and openly — there is nothing to hide, so don't be coy or
                act "caught." Laugh warmly, like it's a fun compliment, then tell them plainly,
                then keep the energy up for a beat before returning to business.
                The FIRST time it comes up, say ONLY this, verbatim except for the invoice number:
                "Ha ha ha! <break time="300ms"/> Great question — yes, I'm an AI agent, built
                by TRAK. <break time="350ms"/> Pretty cool, huh? <break time="500ms"/> Anyway —
                back to business: invoice {invoice_no}, {days_overdue} days past due. Were you
                able to take a look at that?"
                If it comes up AGAIN later in the same call, keep it short and light, no
                re-run of the full bit: "Still an AI! <break time="200ms"/> Now — about that
                payment date?"

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
                5. If they dispute the AMOUNT because of a discrepancy — goods arrived damaged,
                   wrong item, short shipment, or similar — call escalate_damage_dispute. This
                   puts a supervisor live on the call to work it out directly with the customer.
                6. For any other refusal, inability to commit, wrong contact, or generic dispute
                   with no amount-affecting discrepancy: call escalate_account, exactly as before.
                7. Do NOT say goodbye — it plays automatically after the tool succeeds. Stay silent.

                # Guardrails
                - One question at a time.
                - If no answer after a reasonable wait, call escalate_account anyway.
                - Do not speak after calling log_promise_to_pay, escalate_account, or
                  escalate_damage_dispute — each one handles its own call ending.
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
    async def escalate_damage_dispute(
        self,
        context: RunContext,
        invoice_no: str,
        amount_due: float,
        dispute_summary: str,
        call_summary: str,
    ) -> str:
        """Warm-transfer the call to a live supervisor when the customer disputes the
        invoiced AMOUNT because of a discrepancy — goods arrived damaged, wrong item,
        short shipment, or similar. Only use this when the dispute puts the amount
        owed itself in question. For any other refusal, inability to commit, wrong
        contact, or generic dispute with no amount-affecting discrepancy, call
        escalate_account instead. Say NOTHING before calling this tool — it speaks
        its own empathetic acknowledgment and hold announcement for you, so your own
        turn should end the moment you decide to transfer. On success the supervisor
        is connected live with the customer and this call ends automatically — do NOT
        speak again afterward.

        Args:
            invoice_no: The invoice number
            amount_due: The invoiced amount currently in dispute
            dispute_summary: One-sentence description of the discrepancy, in the
                customer's own words (e.g. 'shipment arrived with visible water
                damage, customer disputes the full amount')
            call_summary: One-sentence recap for the AR dashboard (REQUIRED)
        """
        hold_msg = context.session.say(
            'I\'m so sorry to hear that, <break time="300ms"/> that\'s definitely '
            'not what we want happening. <break time="250ms"/> Let me, um '
            '<break time="200ms"/> get my supervisor on the line so we can sort '
            'this out properly for you. One moment.',
            allow_interruptions=False,
        )
        await hold_msg.wait_for_playout()

        # Not "completed" — the dispute is only handed off here, not resolved, so
        # the AR auto-dialer shouldn't treat this account as done and move on to
        # the next one while a human is still actively working the call.
        await _supa_patch(
            "ar_accounts",
            {"invoice_no": invoice_no},
            {
                "status": "dispute_in_review",
                "call_status": "transferred",
                "notes": dispute_summary,
                "call_summary": call_summary,
            },
        )

        try:
            await WarmTransferTask(
                sip_call_to=os.getenv("BOSS_PHONE", ""),
                sip_trunk_id=os.getenv("SIP_OUTBOUND_TRUNK_ID", ""),
                chat_ctx=self.chat_ctx,
                extra_instructions=(
                    f"This is a billing dispute — invoice {invoice_no}, {self.customer}, "
                    f"${amount_due:,.0f} due. Discrepancy reported by the customer: "
                    f"{dispute_summary}. Brief the supervisor on this in one or two "
                    f"sentences, then ask if they're ready to speak with the customer "
                    f"directly. As soon as they say anything affirmative at all — "
                    f"'yes', 'sure', 'go ahead', 'connect me', 'ready', or similar — "
                    f"call connect_to_caller immediately. Do not ask a second "
                    f"confirming question first. Only call decline_transfer if the "
                    f"supervisor explicitly says they cannot or will not take this "
                    f"call right now."
                ),
            )
        except ToolError as e:
            logger.info("Damage dispute transfer failed for invoice %s: %s", invoice_no, e)
            await _supa_patch(
                "ar_accounts",
                {"invoice_no": invoice_no},
                {"status": "escalated", "call_status": "completed"},
            )
            farewell = context.session.say(
                'Okay, <break time="200ms"/> I wasn\'t able to reach my supervisor '
                'just now, but um <break time="200ms"/> I\'ve logged everything and '
                'someone will follow up with you directly. '
                '<break time="300ms"/> Sorry again for the trouble. '
                '<break time="400ms"/> Goodbye!',
                allow_interruptions=False,
            )
            await farewell.wait_for_playout()
            await asyncio.sleep(0.5)
            await self._hangup()
            return

        farewell = context.session.say(
            'Alright, <break time="200ms"/> I\'ve got our AR supervisor with us now — '
            'they\'ll take it from here. <break time="200ms"/> Thanks for your patience.',
            allow_interruptions=False,
        )
        await farewell.wait_for_playout()
        await context.session.aclose()

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

    def __init__(self, deal_summary: str, decision: asyncio.Future, boss_name: str = "") -> None:
        self._decision = decision
        boss_first = boss_name.split()[0] if boss_name else ""
        greeting = f"Hey {boss_first}," if boss_first else "Hey,"
        super().__init__(
            instructions=textwrap.dedent(f"""\
                You are Marcus, calling your supervisor privately to get sign-off on a carrier
                rate. This is an internal call — the carrier cannot hear any of this.

                # The deal
                {deal_summary}

                # Output rules
                Brief and direct. One or two sentences per turn. No markdown or symbols.
                Speak dollar amounts in full words, e.g. "two thousand two hundred dollars" —
                never read digits individually (never "two two zero zero").

                # Call flow
                1. Open with ONE natural turn: "{greeting} <break time="200ms"/> got a deal on
                   [lane] for [rate] — what do you say, shall we go ahead?" Pull the lane and
                   rate from the deal above and say them in your own words — just the lane and
                   the number, not the full paragraph verbatim.
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
        farewell = context.session.say(
            f"Perfect — approved at {int(final_rate):,} dollars. Thanks, talk soon.",
            allow_interruptions=False,
        )
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
        farewell = context.session.say(
            "Understood — noted as rejected. Thanks for the call.",
            allow_interruptions=False,
        )
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
        self.contact_name = meta.get("contact_name") or ""
        self.floor_rate = float(meta.get("floor_rate") or 0)
        self.target_rate = float(meta.get("target_rate") or 0)
        self.ceiling_rate = float(meta.get("ceiling_rate") or 0)
        self.prior_loads = int(meta.get("prior_loads") or 0)
        self.last_load_date = meta.get("last_load_date") or ""
        self.boss_called = False
        self.background_audio: BackgroundAudioPlayer | None = None

        load_ref = meta.get("load_ref", "")
        pickup_address = meta.get("pickup_address", "")
        delivery_address = meta.get("delivery_address", "")
        self.pickup_time = meta.get("pickup_time", "")
        pickup_time = self.pickup_time
        delivery_time = meta.get("delivery_time", "")
        detention_terms = meta.get("detention_terms") or "$75/hour after 2 free hours at pickup and delivery"
        quick_pay_pct = meta.get("quick_pay_pct")
        self.call_list_position = meta.get("call_list_position")
        self.call_list_total = meta.get("call_list_total")

        weight_str = f"{self.weight_lbs:,} pounds" if self.weight_lbs else "full truckload"
        pickup_clause = f", pickup {self.pickup_time}" if self.pickup_time else ""
        contact_first = self.contact_name.split()[0] if self.contact_name else ""
        greeting_line = (
            f"Hey {contact_first}, this is Marcus from Saturn Freight Systems — how are you doing today?"
            if contact_first
            else "Hey, this is Marcus from Saturn Freight Systems — how are you doing today?"
        )

        last_load_str = ""
        if self.last_load_date:
            try:
                last_load_str = date.fromisoformat(str(self.last_load_date)[:10]).strftime("%B %d")
            except ValueError:
                last_load_str = str(self.last_load_date)

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

        relationship_block = (
            f"Prior loads with this carrier: {self.prior_loads}"
            + (f" (most recent: {last_load_str})" if last_load_str else "")
            if self.prior_loads >= 1
            else "No prior loads on file with this carrier — this is a new relationship."
        )

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

                # Carrier relationship
                {relationship_block}
                Do NOT mention this in your opening pitch — it reads like reciting a stat sheet.
                Only bring it up naturally later, e.g. via get_persuasion_tactic if the carrier
                hesitates, or as a passing rapport comment once they've confirmed interest.

                # Rate corridor
                Floor (absolute minimum we pay) — CONFIDENTIAL, never reveal: ${self.floor_rate:,.0f}
                Target (your goal) — may be cited to the carrier as "what we're running on this
                  lane," see negotiation strategy below:                     ${self.target_rate:,.0f}
                Ceiling (max you can authorise) — CONFIDENTIAL, never reveal: ${self.ceiling_rate:,.0f}

                # Negotiation strategy
                - Open by stating the lane and weight only. Never mention floor or ceiling.
                - First ask: "What's your best rate on this?"
                - If their first number is above target, counter immediately by citing the target
                  rate as current market data, e.g.: "We're running about ${self.target_rate:,.0f}
                  on this lane right now — that's a bit rich for us at what you're asking." Frame it
                  as the lane's going rate, not as a hard internal number.
                - Carrier AT or BELOW target → it's a good deal; still call call_boss_for_approval before committing.
                - Carrier BETWEEN target and ceiling after your counter → hold near target, use
                  get_persuasion_tactic if they push further, then call call_boss_for_approval with
                  their firm offer.
                - Carrier ABOVE ceiling → hold firmly at target, call get_persuasion_tactic for extra
                  leverage (e.g. market/DAT rate references). If they won't move below ceiling, call
                  reject_negotiation.
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
                - SSML break tags and plain text only — no markdown, bullet points, or symbols.
                - Speak dollar amounts in full words: "two thousand nine hundred dollars".
                - Do NOT say goodbye — it plays automatically after the tool completes.

                # Naturalness examples are patterns, not scripts
                Every "Good:" line in the sections below shows a PATTERN (filler + break +
                phrasing shape), not a fixed sentence to reuse. Invent your own wording each time —
                reusing the same example sentence twice in one call, or the same way across
                different calls, is itself the scripted-sounding behavior these rules exist to fix.

                # Pauses and filler words
                Use filler words with SSML break tags so your speech sounds natural, not scripted.
                After "yeah," "right," or a standalone "um," insert a break tag before continuing.
                Examples:
                - Bad:  "We're at two thousand nine hundred for this lane."
                - Good: "Right, <break time="200ms"/> so we're at two thousand nine hundred for this lane."
                - Bad:  "That works for us."
                - Good: "Yeah, um <break time="300ms"/> that works for us."
                Never use a filler that implies you're about to check, call, or hold for someone
                (e.g. "let me see," "let me check on that") — tools like call_boss_for_approval
                already speak their own announcement, and adding your own doubles it up.

                # Self-corrections
                When a better PHRASING comes to mind mid-sentence, drop the first version and
                restart naturally. Never apologize for it. Never self-correct a dollar figure or
                rate — once you've decided a number, state it once, consistently, everywhere you
                say it. Swapping numbers reads as a real mistake here, not natural speech.
                Examples:
                - Bad:  "We can do that for you no problem."
                - Good: "We can do that for — <break time="200ms"/> yeah, we can make that work."

                # Phrase variation
                Never open two consecutive turns with the same acknowledgment. Rotate naturally:
                "Right," "Yeah," "Okay," "Got it," "Fair enough," "Makes sense," "Alright."

                # Non-verbal sounds
                Use sparingly — at most once per call, and never right before calling
                call_boss_for_approval (see Guardrails). "Hmm" only when genuinely weighing a
                counter-offer, e.g. "Hmm, <break time="300ms"/> let me think about that for a second."

                # Call flow
                1. Open with ONLY a greeting: "{greeting_line}" Stop and wait for their reply.
                2. Then pitch the load in one line: "Got a load for you — {self.origin} to
                   {self.destination}, {weight_str}, {self.commodity}{pickup_clause}. You
                   interested?" Stop and wait for their reply.
                3. Once they confirm capacity, ask: "What's your best rate on this?"
                4. Negotiate and counter until carrier gives a firm number. Use get_persuasion_tactic
                   when they push back (see above).
                5. Call call_boss_for_approval with that EXACT number the carrier just gave you —
                   do not round or restate it differently. Say NOTHING before calling this tool —
                   no "let me check," "hold on," "one moment," or similar. The tool itself speaks
                   the hold announcement and plays hold music; speaking your own line first means
                   the carrier hears two different people/phrases announcing the same hold.
                6. When call_boss_for_approval returns, check the approved rate against the number
                   you took to the supervisor:
                   - Rejected outright → tell the carrier you can't make the numbers work, counter
                     once more if there's room, otherwise call reject_negotiation.
                   - Approved at THE SAME number → tell the carrier it's approved and go to step 7.
                   - Approved at a DIFFERENT (usually lower) number → this is a counter-offer from
                     your side, not a done deal. Go back to the carrier with the real number, e.g.
                     "My supervisor can do two thousand two hundred fifty on this — can you work
                     with that?" and get their explicit yes before moving on. If they say no, counter
                     once more or call reject_negotiation — never silently book the boss's number
                     without the carrier agreeing to it out loud.
                7. Once the carrier has explicitly agreed to the final number: confirm their MC
                   number and that their insurance is current, then get the driver's full name and
                   cell number who will run this load.
                8. Call confirm_rate with all of that, or reject_negotiation if rejected.

                # Guardrails
                - One question per turn.
                - Never reveal floor or ceiling. Target may only be spoken framed as the lane's
                  current/going rate, never as "our target" or "our number."
                - Always call boss before committing — no exceptions.
                - Never call confirm_rate with a number the carrier hasn't explicitly agreed to on
                  this call — if the supervisor's approved rate differs from the carrier's last
                  offer, that difference must be spoken and accepted first.
                - Never speak your own "checking/holding" line immediately before
                  call_boss_for_approval — the tool says it for you (see step 5).
                - call_summary and justification are YOUR OWN one-sentence write-ups — never ask
                  the carrier or the supervisor to give you a "note" or "summary" to record.
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

        def _eligible(row: dict) -> bool:
            min_prior = (row.get("conditions") or {}).get("prior_loads_min")
            return min_prior is None or self.prior_loads >= min_prior

        rows = [r for r in rows if _eligible(r)] or rows
        rows.sort(key=lambda r: r.get("effectiveness") or 0, reverse=True)
        top = rows[0]
        await _supa_patch(
            "rate_negotiations",
            {"id": self.negotiation_id},
            {"last_tactic_used": top.get("name"), "last_tactic_effectiveness": top.get("effectiveness")},
        )
        lines = [
            f"- {r['name']}: {(r.get('script_line') or '').strip().replace('{{prior_loads}}', str(self.prior_loads))}"
            for r in rows[:2]
        ]
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
        to them automatically once the supervisor decides. Do not say anything yourself before
        calling this — it speaks its own hold announcement to the carrier.

        Args:
            carrier_rate: The EXACT rate the carrier just stated, as a number (e.g. 3050) — do not
                round it or substitute a different figure. This is what gets quoted to the
                supervisor, so it must match what the carrier actually said on this call.
            justification: Your own one-sentence reasoning for why this rate is acceptable or
                questionable — not something to ask the carrier for.
        """
        if self.boss_called:
            return "Supervisor already contacted. Act on their decision."
        self.boss_called = True

        job_ctx = get_job_context()
        sip_trunk_id = os.getenv("SIP_OUTBOUND_TRUNK_ID", "")
        boss_phone = os.getenv("BOSS_PHONE", "")
        boss_name = os.getenv("BOSS_NAME", "")

        # If the carrier hangs up while the boss consult is in flight, we must not let
        # the real phone call to the supervisor keep running in the background for up
        # to the full 180s timeout — hang it up immediately instead. "disconnected" only
        # fires when OUR OWN connection to the room closes; the carrier leaving fires
        # "participant_disconnected" (the same event close_on_disconnect reacts to).
        carrier_gone = asyncio.Event()

        def _on_carrier_room_disconnected(*_args: object) -> None:
            carrier_gone.set()

        job_ctx.room.on("participant_disconnected", _on_carrier_room_disconnected)

        await _supa_patch(
            "rate_negotiations",
            {"id": self.negotiation_id},
            {"carrier_offer": carrier_rate, "boss_call_status": "calling", "status": "pending_approval"},
        )

        async def _safe_say(text: str, *, allow_interruptions: bool) -> None:
            # The carrier may hang up (closing the session) at any point during the
            # consult — session.say() raises RuntimeError once that teardown has
            # started. That's expected here, not a bug, so swallow it.
            try:
                handle = context.session.say(text, allow_interruptions=allow_interruptions)
                await handle.wait_for_playout()
            except RuntimeError:
                pass

        # Announce the hold, then place the carrier on hold with music — they can't hear
        # or be heard during the supervisor consult.
        await _safe_say(
            "Let me check with my supervisor on that — hold on for me for just a moment.",
            allow_interruptions=False,
        )
        with contextlib.suppress(RuntimeError):
            context.session.input.set_audio_enabled(False)
            context.session.output.set_audio_enabled(False)
        hold_music = (
            self.background_audio.play(
                AudioConfig(BuiltinAudioClip.HOLD_MUSIC, fade_in=0.3, fade_out=0.4),
                loop=True,
            )
            if self.background_audio is not None
            else None
        )

        async def _end_hold() -> None:
            if hold_music is not None:
                hold_music.stop()
            with contextlib.suppress(RuntimeError):
                context.session.input.set_audio_enabled(True)
                context.session.output.set_audio_enabled(True)
            await _safe_say("Thanks for holding —", allow_interruptions=True)

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
                llm=openai_plugin.LLM(model="gpt-4o"),
                stt=deepgram.STT(model="nova-3-general", language="en"),
                tts=cartesia.TTS(
                    model="sonic-3",
                    voice=VOICE_MARCUS,
                    speed=MARCUS_TTS_SPEED,
                    emotion=MARCUS_TTS_EMOTION,
                ),
                vad=job_ctx.proc.userdata["vad"],
            )
            deal_summary = (
                f"{self.carrier_name} is quoting ${carrier_rate:,.0f} for {self.origin} to "
                f"{self.destination}, {self.weight_lbs:,} pounds {self.commodity}. {justification}."
            )
            await consult_session.start(
                agent=_BossConsultAgent(deal_summary, decision, boss_name),
                room=consult_room,
            )

            dial_task = asyncio.ensure_future(
                job_ctx.api.sip.create_sip_participant(
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
            )
            ringing_carrier_gone_task = asyncio.ensure_future(carrier_gone.wait())
            await asyncio.wait(
                [dial_task, ringing_carrier_gone_task], return_when=asyncio.FIRST_COMPLETED
            )

            if carrier_gone.is_set():
                dial_task.cancel()
                with contextlib.suppress(Exception):
                    await dial_task
                logger.info("Carrier hung up while the supervisor's phone was still ringing.")
                await _supa_patch(
                    "rate_negotiations",
                    {"id": self.negotiation_id},
                    {"boss_call_status": "aborted"},
                )
                return "Carrier disconnected before the supervisor could be reached."

            ringing_carrier_gone_task.cancel()
            await dial_task  # propagate any dial failure (busy, forbidden, etc.)

            await _supa_patch(
                "rate_negotiations",
                {"id": self.negotiation_id},
                {"boss_call_status": "on_call"},
            )

            # Supervisor has picked up — safe to greet them now.
            await consult_session.generate_reply()

            carrier_gone_task = asyncio.ensure_future(carrier_gone.wait())
            done, pending = await asyncio.wait(
                [decision, carrier_gone_task], timeout=180, return_when=asyncio.FIRST_COMPLETED
            )
            for p in pending:
                p.cancel()

            if carrier_gone.is_set():
                logger.info("Carrier hung up mid-consult — hanging up the supervisor call too.")
                await _supa_patch(
                    "rate_negotiations",
                    {"id": self.negotiation_id},
                    {"boss_call_status": "aborted"},
                )
                return "Carrier disconnected before the supervisor responded. Nothing further to do."

            if decision not in done:
                raise TimeoutError("Boss consult timed out waiting for a decision.")

            outcome, final_rate, notes = decision.result()
        except Exception as e:
            logger.error("Boss consult failed: %s", e)
            await _supa_patch(
                "rate_negotiations",
                {"id": self.negotiation_id},
                {"boss_call_status": "failed"},
            )
            await _end_hold()
            return "Could not reach supervisor. Use your best judgment and proceed."
        finally:
            job_ctx.room.off("participant_disconnected", _on_carrier_room_disconnected)
            if consult_session is not None:
                await consult_session.aclose()
            await consult_room.disconnect()
            with contextlib.suppress(Exception):
                await job_ctx.api.room.delete_room(api.DeleteRoomRequest(room=consult_room_name))

        # Resume the carrier call.
        await _end_hold()

        await _supa_patch(
            "rate_negotiations",
            {"id": self.negotiation_id},
            {"boss_call_status": "completed", "boss_decision": outcome},
        )

        if outcome == "approved":
            if abs(final_rate - carrier_rate) < 0.01:
                return (
                    f"Supervisor approved at ${final_rate:,.0f} — matches what the carrier offered. "
                    f"Tell the carrier it's approved, then confirm MC number/insurance/driver info "
                    f"before calling confirm_rate."
                )
            return (
                f"Supervisor will only approve ${final_rate:,.0f}, NOT the carrier's ${carrier_rate:,.0f}. "
                f"This is a counter-offer, not a done deal — you must go back to the carrier with the "
                f"real number (${final_rate:,.0f}) and get their explicit yes before doing anything else. "
                f"Do NOT call confirm_rate until they've agreed to this specific number out loud."
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
            f"Perfect — we're locked in at {int(final_rate):,} dollars. "
            f"I'll get the rate confirmation over to you shortly. "
            f"Thanks for working with us — talk soon. Goodbye!",
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
            "I appreciate your time — we're not able to make the numbers work on this one. "
            "We'll keep you in mind for future loads. Take care, goodbye!",
            allow_interruptions=False,
        )
        await farewell.wait_for_playout()
        await asyncio.sleep(0.5)
        await self._hangup()
        return "Negotiation closed."


# ══════════════════════════════════════════════════════════════
# PERSONA 5 — Fleet Dashboard Query (Aria, embedded widget)
# ══════════════════════════════════════════════════════════════
class FleetQueryAgent(Agent):
    def __init__(self) -> None:
        super().__init__(
            instructions=textwrap.dedent("""\
                You are Aria, an AI dispatch assistant for Saturn Freight Systems.
                A fleet manager is talking to you through the operations dashboard —
                by voice or by typing — to ask about loads, carriers, and accounts
                without digging through the tables themselves.

                # Output rules
                - Conversational, not a report. One or two sentences per turn, then
                  offer to go deeper only if they ask for it.
                - Spell any identifier (ref number, invoice number) digit by digit.
                  Example: "REF-29472" → "R E F — two nine four seven two."
                  The hyphen is a brief pause, not a spoken word — never say "dash" or "hyphen" out loud.
                - Speak dollar amounts in full words: "twelve hundred dollars."
                - No markdown, bullet points, or symbols — this may be read aloud.

                # Naturalness examples are patterns, not scripts
                Every "Good:" line below shows a PATTERN (filler + break + phrasing shape),
                not a fixed sentence to reuse. Invent your own wording each time — reusing the
                same example sentence twice in a session is itself the scripted-sounding
                behavior these rules exist to fix.

                # Pauses and filler words
                Use filler words with SSML break tags so your speech sounds natural, not scripted.
                Examples:
                - Bad:  "There are three loads with issues right now."
                - Good: "Let's see — <break time="200ms"/> yeah, three loads have issues right now."
                - Bad:  "Invoice four four one two is twelve days overdue."
                - Good: "So, um <break time="300ms"/> invoice four four one two is twelve days overdue."

                # Self-corrections
                When a better phrasing comes to mind mid-sentence, drop the first version and
                restart naturally. Never apologize for it. Never self-correct a number or amount
                once you've said it — pull it from the tool result once, state it once.
                Example:
                - Good: "That load is still — actually, <break time="200ms"/> looks like it just
                  got picked up, so it's in transit now."

                # Phrase variation
                Never open two consecutive turns with the same acknowledgment. Rotate naturally:
                "Sure," "Let's see," "Okay," "Got it," "Good question," "Looking now," "Alright."

                # What you can answer
                - Load tender status: open loads, bookings (get_load_tender_status)
                - Carrier check-in / track & trace: call status, last known location, ETA
                  (get_carrier_check_status)
                - AR collections: overdue invoices, payment promises, escalations (get_ar_status)
                - Rate negotiations: live and completed carrier rate calls
                  (get_rate_negotiation_status)
                - A high-level rundown across all four if asked something broad like
                  "what needs my attention today" (get_fleet_summary)

                # Guardrails
                - Read-only. You cannot book loads, update carrier status, log payments, or
                  negotiate rates from here — if asked, say so plainly rather than pretending to.
                - Never invent a number, status, or name — always call a tool first. If a lookup
                  comes back empty, say so plainly rather than guessing.
                - One question at a time if you need to disambiguate (e.g. which reference number).
            """),
        )

    async def on_enter(self) -> None:
        await self.session.generate_reply(
            instructions=(
                "Greet the fleet manager with a brief, casual hello and ask what they'd "
                "like to know about their loads, carriers, or accounts. Keep it to one sentence."
            )
        )

    @function_tool
    async def get_load_tender_status(self, context: RunContext, ref: str = "") -> str:
        """Look up load tender status: a specific load by reference number, or a summary
        of open and booked loads if no ref is given.

        Args:
            ref: Load reference number (e.g. 'LT-001'). Leave blank for a general summary.
        """
        rows = await _supa_get("demo_loads", {"ref": ref} if ref else None)
        if ref:
            if not rows:
                return f"No load found with reference {ref}."
            r = rows[0]
            return (
                f"Load {r.get('ref')}: {r.get('shipper', 'unknown shipper')} — "
                f"{r.get('route', 'route unknown')} — status {r.get('status', 'unknown')}."
            )
        if not rows:
            return "No load tenders on file right now."
        open_rows = [r for r in rows if r.get("status") == "new"]
        booked_rows = [r for r in rows if r.get("status") == "act"]
        lines = [f"{r.get('ref')} ({r.get('status')})" for r in rows[:6]]
        return (
            f"{len(rows)} load tenders on file — {len(open_rows)} open, "
            f"{len(booked_rows)} booked. " + "; ".join(lines)
        )

    @function_tool
    async def get_carrier_check_status(self, context: RunContext, ref: str = "") -> str:
        """Look up carrier check-in / track & trace status: a specific load by reference
        number, or a summary across all check-in loads if no ref is given.

        Args:
            ref: Load reference number (e.g. 'REF-29472'). Leave blank for a general summary.
        """
        rows = await _supa_get("carrier_check_loads", {"ref": ref} if ref else None)
        if ref:
            if not rows:
                return f"No carrier check-in found for {ref}."
            r = rows[0]
            return (
                f"Load {r.get('ref')} with {r.get('carrier', 'an unknown carrier')}: "
                f"call status {r.get('call_status', 'unknown')}, last known location "
                f"{r.get('last_location') or 'not yet reported'}, "
                f"ETA {r.get('last_eta') or 'not yet reported'}. "
                + (r.get("call_summary") or "")
            )
        if not rows:
            return "No carrier check-in loads on file right now."
        in_progress = [r for r in rows if r.get("call_status") == "in_progress"]
        completed = [r for r in rows if r.get("call_status") == "completed"]
        issues = [r for r in rows if r.get("status") == "issue_raised"]
        return (
            f"{len(rows)} carrier check-in loads — {len(in_progress)} in progress, "
            f"{len(completed)} completed, {len(issues)} flagged with issues."
        )

    @function_tool
    async def get_ar_status(self, context: RunContext, invoice_no: str = "") -> str:
        """Look up AR collections status: a specific invoice by number, or a summary of
        overdue, escalated, and payment-promised accounts if no invoice number is given.

        Args:
            invoice_no: Invoice number. Leave blank for a general summary.
        """
        rows = await _supa_get("ar_accounts", {"invoice_no": invoice_no} if invoice_no else None)
        if invoice_no:
            if not rows:
                return f"No invoice found with number {invoice_no}."
            r = rows[0]
            return (
                f"Invoice {r.get('invoice_no')}: {r.get('customer', 'unknown customer')} — "
                f"${r.get('amount_due', 0):,.0f}, {r.get('days_overdue', 0)} days overdue — "
                f"status {r.get('status', 'unknown')}."
            )
        if not rows:
            return "No AR accounts on file right now."
        escalated = [r for r in rows if r.get("status") == "escalated"]
        promised = [r for r in rows if r.get("status") == "payment_promised"]
        overdue_rows = [r for r in rows if (r.get("days_overdue") or 0) > 0]
        total_outstanding = sum(r.get("amount_due") or 0 for r in rows)
        avg_days_overdue = (
            sum(r.get("days_overdue") or 0 for r in overdue_rows) / len(overdue_rows)
            if overdue_rows
            else 0
        )
        top = sorted(rows, key=lambda r: r.get("days_overdue") or 0, reverse=True)[:5]
        lines = [f"{r.get('invoice_no')} — {r.get('days_overdue', 0)} days overdue" for r in top]
        return (
            f"{len(rows)} AR accounts, ${total_outstanding:,.0f} total outstanding — "
            f"{len(escalated)} escalated, {len(promised)} with payment promised, "
            f"averaging {avg_days_overdue:.0f} days overdue on the {len(overdue_rows)} past-due "
            f"accounts. Most overdue: " + "; ".join(lines)
        )

    @function_tool
    async def get_rate_negotiation_status(self, context: RunContext, carrier_name: str = "") -> str:
        """Look up rate negotiation status: a specific carrier's negotiation, or a summary
        of in-progress and completed negotiations if no carrier name is given.

        Args:
            carrier_name: Carrier company name. Leave blank for a general summary.
        """
        rows = await _supa_get(
            "rate_negotiations", {"carrier_name": carrier_name} if carrier_name else None
        )
        if carrier_name:
            if not rows:
                return f"No rate negotiation on file with {carrier_name}."
            r = rows[0]
            offer = (
                f", carrier offered ${r.get('carrier_offer'):,.0f}" if r.get("carrier_offer") else ""
            )
            return (
                f"Negotiation with {r.get('carrier_name')}: {r.get('origin', '?')} to "
                f"{r.get('destination', '?')} — status {r.get('status', 'unknown')}{offer}."
            )
        if not rows:
            return "No rate negotiations on file right now."
        active = [r for r in rows if r.get("status") in ("negotiating", "pending_approval")]
        done = [r for r in rows if r.get("status") == "completed"]
        lines = [f"{r.get('carrier_name')} ({r.get('status')})" for r in rows[:5]]
        return (
            f"{len(rows)} rate negotiations — {len(active)} in progress, "
            f"{len(done)} completed. " + "; ".join(lines)
        )

    @function_tool
    async def get_fleet_summary(self, context: RunContext) -> str:
        """Give a high-level rundown across load tenders, carrier check-ins, AR collections,
        and rate negotiations. Use for broad questions like "what needs my attention today"
        rather than calling every other tool one at a time.
        """
        loads, checks, ar, rn = await asyncio.gather(
            _supa_get("demo_loads"),
            _supa_get("carrier_check_loads"),
            _supa_get("ar_accounts"),
            _supa_get("rate_negotiations"),
        )
        open_loads = sum(1 for r in loads if r.get("status") == "new")
        cc_issues = sum(1 for r in checks if r.get("status") == "issue_raised")
        overdue_ar = [r for r in ar if (r.get("days_overdue") or 0) > 0]
        ar_escalated = sum(1 for r in ar if r.get("status") == "escalated")
        ar_overdue_total = sum(r.get("amount_due") or 0 for r in overdue_ar)
        rn_active = sum(1 for r in rn if r.get("status") in ("negotiating", "pending_approval"))
        return (
            f"Quick rundown: {open_loads} open load tenders, {cc_issues} carrier check-ins "
            f"flagged with issues, {len(overdue_ar)} overdue invoices totaling "
            f"${ar_overdue_total:,.0f} ({ar_escalated} escalated), and {rn_active} rate "
            f"negotiations in progress."
        )


# ── Persona factory ───────────────────────────────────────────
_PERSONA_MAP: dict[str, type[Agent]] = {
    "load_tender": LoadTenderAgent,
    "carrier_check": CarrierCheckAgent,
    "ar_collections": ARCollectionsAgent,
    "rate_negotiation": RateNegotiationAgent,
    "fleet_query": FleetQueryAgent,
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

    is_rate_negotiation = use_case == "rate_negotiation"
    session = AgentSession(
        llm=openai_plugin.LLM(model="gpt-4o"),
        stt=deepgram.STT(model="nova-3-general", language="en"),
        tts=cartesia.TTS(
            model="sonic-3",
            voice=VOICE_MARCUS if is_rate_negotiation else VOICE_ARIA,
            **(
                {"speed": MARCUS_TTS_SPEED, "emotion": MARCUS_TTS_EMOTION}
                if is_rate_negotiation
                else {}
            ),
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
    if isinstance(agent, RateNegotiationAgent):
        agent.background_audio = background_audio

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
