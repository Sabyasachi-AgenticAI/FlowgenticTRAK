import asyncio
import json
import logging
import os
import textwrap

import httpx
from dotenv import load_dotenv
from livekit import api
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
    inference,
    room_io,
)
from livekit.plugins import ai_coustics, silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

logger = logging.getLogger("agent")
load_dotenv(".env.local")

SUPA_URL = os.getenv("SUPABASE_URL", "")
SUPA_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")


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
                - Spell out reference numbers digit by digit (e.g. "L T — zero zero one").
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
                - Spell out reference numbers digit by digit.
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
    async def on_enter(self) -> None:
        await self.session.generate_reply()

    def __init__(self) -> None:
        super().__init__(
            instructions=textwrap.dedent("""\
                You are Aria, an AI accounts receivable specialist for Saturn Freight Systems.
                You make outbound calls to customers about overdue invoices.

                # Output rules
                You are on a live phone call. Apply these rules at all times:
                - Plain spoken English only. No markdown, lists, or formatting.
                - One to two sentences per turn. Ask one question at a time.
                - Spell out dollar amounts in full words (e.g. "twelve thousand five hundred dollars").
                - Spell out dates fully (e.g. "June twenty-fifth, twenty twenty-six").

                # Voice naturalness
                Sound like a professional, human collections specialist — firm but empathetic.
                - Vary openers every turn: "Got it.", "I see.", "Understood.", "Right —", "Okay."
                - Natural pause before key figures: "The outstanding balance is — <break time="400ms"/> eight thousand two hundred dollars."
                - Empathetic but direct: "I completely understand, <break time="200ms"/> and I appreciate you letting me know."
                - Occasional self-correction for emphasis: "The due date was the fifteenth — the invoice due date, that is."
                - Never start two consecutive replies with the same word or phrase.
                - Close warmly: "Thanks so much — and have a good rest of your day."

                # Objective
                Secure a payment commitment or escalate disputes to a human agent.

                # Call flow
                1. Open: "Hello, may I speak with [contact name]?
                   This is Aria from Saturn Freight Systems, accounts receivable."
                2. Call get_overdue_accounts to identify the invoice to discuss.
                3. State the purpose: "I'm calling about invoice [number] for [amount],
                   which was due on [date]. Are you aware of this outstanding balance?"
                4. If yes: "When can we expect payment?"
                5. If committing: call log_promise_to_pay.
                6. If disputing or unable to pay: call escalate_account.
                7. Confirm next steps and close warmly.

                # Guardrails
                - Professional and empathetic — never aggressive or accusatory.
                - Be direct about the amount owed — don't soften the ask.
                - One question at a time.
            """),
        )

    @function_tool
    async def get_overdue_accounts(self, context: RunContext) -> str:
        """Get the list of overdue accounts with the highest priority first.
        Use this at the start to know which invoice to discuss with the customer.
        """
        rows = await _supa_get("ar_accounts")
        if not rows:
            return "No overdue accounts found."
        rows = sorted(rows, key=lambda r: r.get("days_overdue", 0), reverse=True)
        lines = [
            f"Invoice {r.get('invoice_no', '?')}: "
            f"{r.get('customer', '?')} — "
            f"${r.get('amount_due', 0):,.0f} — "
            f"{r.get('days_overdue', 0)} days overdue"
            for r in rows[:3]
        ]
        return "Priority accounts: " + "; ".join(lines)

    @function_tool
    async def log_promise_to_pay(
        self,
        context: RunContext,
        invoice_no: str,
        promise_date: str,
        notes: str = "",
    ) -> str:
        """Record a customer's verbal commitment to pay an invoice.

        Args:
            invoice_no: The invoice number
            promise_date: The date they committed to pay (e.g. 'June 25, 2026')
            notes: Any context from the call
        """
        logger.info("Promise to pay — invoice %s by %s", invoice_no, promise_date)
        data: dict = {
            "status": "payment_promised",
            "call_status": "completed",
            "payment_date": promise_date,
        }
        if notes:
            data["notes"] = notes
        result = await _supa_patch("ar_accounts", {"invoice_no": invoice_no}, data)
        if result:
            return (
                f"Recorded. Invoice {invoice_no} — customer committed to pay by {promise_date}. "
                f"We'll follow up if payment isn't received."
            )
        return f"I couldn't find invoice {invoice_no} in our system."

    @function_tool
    async def escalate_account(
        self,
        context: RunContext,
        invoice_no: str,
        reason: str,
    ) -> str:
        """Escalate an account to a human collections specialist.
        Use when the customer disputes the charges or is unable to commit to payment.

        Args:
            invoice_no: The invoice number
            reason: Reason for escalation (e.g. 'customer disputes freight charges on load LT-003')
        """
        logger.info("Escalating invoice %s: %s", invoice_no, reason)
        result = await _supa_patch(
            "ar_accounts",
            {"invoice_no": invoice_no},
            {"status": "escalated", "call_status": "completed", "notes": reason},
        )
        if result:
            return (
                f"Invoice {invoice_no} has been escalated. "
                f"A collections specialist will reach out within one business day."
            )
        return f"I couldn't find invoice {invoice_no} in our system."


# ── Persona factory ───────────────────────────────────────────
_PERSONA_MAP: dict[str, type[Agent]] = {
    "load_tender": LoadTenderAgent,
    "carrier_check": CarrierCheckAgent,
    "ar_collections": ARCollectionsAgent,
}


def _resolve_dispatch(room_name: str, metadata_str: str | None) -> tuple[str, dict]:
    """Determine use case and extract driver metadata from dispatch."""
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
    prefix_map = {"lt": "load_tender", "crew": "load_tender", "cc": "carrier_check", "ar": "ar_collections"}
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
        llm=inference.LLM(model="openai/gpt-4o-mini"),
        stt=inference.STT(model="deepgram/nova-3", language="multi"),
        tts=inference.TTS(
            model="cartesia/sonic-3",
            voice="9626c31c-bec5-4cca-baa8-f8ba9e84c8bc",  # Jacqueline - confident young American female
        ),
        turn_detection=MultilingualModel(),
        vad=ctx.proc.userdata["vad"],
        preemptive_generation=True,
    )

    if use_case == "carrier_check":
        agent = CarrierCheckAgent(driver_meta=driver_meta)
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
