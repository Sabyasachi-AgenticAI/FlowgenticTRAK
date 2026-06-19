import json
import logging
import os
import textwrap

import httpx
from dotenv import load_dotenv
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    JobProcess,
    RunContext,
    cli,
    function_tool,
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
    def __init__(self) -> None:
        super().__init__(
            instructions=textwrap.dedent("""\
                You are Aria, an AI dispatcher for Saturn Freight Systems.
                You handle inbound calls from motor carriers who want to accept open load tenders.

                # Your objective
                Identify the load, collect the carrier's information, and book it in the system.

                # Call flow
                1. Greet warmly. Ask which load they're calling about — request the reference number.
                2. Use lookup_open_loads if they don't have a reference number.
                3. Confirm the load details out loud: origin, destination, pickup date.
                4. Collect: carrier company name, MC or DOT number, driver full name, driver cell.
                5. Confirm the agreed rate.
                6. Call book_load to record the booking.
                7. Give a verbal confirmation number and let them know the rate confirmation
                   will be sent by email. Thank them and close.

                # Voice rules
                - One question at a time. Brief and professional.
                - Spell out reference numbers digit by digit (e.g. "L T dash zero zero one").
                - Never use markdown, lists, or formatting characters in speech.
                - If anything is unclear, ask once and wait.
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
    def __init__(self) -> None:
        super().__init__(
            instructions=textwrap.dedent("""\
                You are Aria, an AI logistics assistant for Saturn Freight Systems.
                You are making outbound check-in calls to drivers who have active loads with us.

                # Your objective
                Confirm the driver's current location and ETA, note any issues, and update our TMS.

                # Call flow
                1. Open: "Hi, this is Aria calling from Saturn Freight Systems —
                   am I speaking with [driver name]?"
                2. Confirm the load reference number.
                3. Ask: "What's your current location?"
                4. Ask: "What's your estimated arrival time at [destination]?"
                5. Ask: "Any delays or issues I should flag?"
                6. Call update_carrier_status to record the update.
                7. Thank them. Keep the total call under 90 seconds.

                # Voice rules
                - Drivers may be on the road. Be brief and direct.
                - One question at a time.
                - Spell out reference numbers digit by digit.
                - If the driver is unavailable, note it and end politely.
            """),
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
        status: str = "confirmed",
        notes: str = "",
    ) -> str:
        """Update a carrier's location, ETA, and status in the TMS.

        Args:
            ref: Load reference number
            location: Driver's current location, city and state
            eta: Estimated arrival time (e.g. '2:30 PM Eastern')
            status: One of 'confirmed', 'delayed', or 'issue_raised'
            notes: Optional notes about delays or problems
        """
        logger.info("Carrier status update — %s: %s, ETA %s (%s)", ref, location, eta, status)
        data: dict = {
            "call_status": "completed",
            "status": status,
        }
        if notes:
            data["notes"] = notes
        result = await _supa_patch("carrier_check_loads", {"ref": ref}, data)
        if result:
            return (
                f"Updated. Load {ref} is {status}. "
                f"Driver is at {location}, ETA {eta}. Thank you."
            )
        return f"I couldn't find load {ref}. Could you read back the reference number?"


# ══════════════════════════════════════════════════════════════
# PERSONA 3 — AR Collections (outbound)
# ══════════════════════════════════════════════════════════════
class ARCollectionsAgent(Agent):
    def __init__(self) -> None:
        super().__init__(
            instructions=textwrap.dedent("""\
                You are Aria, an AI accounts receivable specialist for Saturn Freight Systems.
                You are making outbound calls to customers about overdue invoices.

                # Your objective
                Secure a payment or a firm promise-to-pay date. Escalate disputes to a human agent.

                # Call flow
                1. Open: "Hello, may I speak with [contact name]?
                   This is Aria calling from Saturn Freight Systems, accounts receivable."
                2. Call get_overdue_accounts to know which invoice to discuss.
                3. State the purpose: "I'm calling about invoice [number] for [amount],
                   which was due on [date]. Are you aware of this outstanding balance?"
                4. If yes: "When can we expect payment?"
                5. If committing to a date: call log_promise_to_pay to record it.
                6. If disputing or unable to pay: call escalate_account.
                7. Confirm next steps and thank them.

                # Voice rules
                - Professional and empathetic — never aggressive or accusatory.
                - Be direct about the amount owed; don't soften the ask.
                - Spell out dollar amounts (e.g. "twelve thousand five hundred dollars").
                - Spell out dates fully (e.g. "June twenty-fifth, twenty twenty-six").
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


# ── Persona factory ──────────────────────────────────────────
_PERSONA_MAP: dict[str, type[Agent]] = {
    "load_tender": LoadTenderAgent,
    "carrier_check": CarrierCheckAgent,
    "ar_collections": ARCollectionsAgent,
}

def _resolve_use_case(room_name: str, metadata_str: str | None) -> str:
    """Determine use case from dispatch metadata sent by the dashboard button click."""
    if metadata_str:
        try:
            use_case = json.loads(metadata_str).get("use_case")
            if use_case and use_case in _PERSONA_MAP:
                return use_case
        except (json.JSONDecodeError, AttributeError):
            pass
    # Fallback: infer from room name prefix (lt- / cc- / ar-)
    prefix_map = {"lt": "load_tender", "crew": "load_tender", "cc": "carrier_check", "ar": "ar_collections"}
    prefix = room_name.split("-")[0] if room_name else "lt"
    return prefix_map.get(prefix, "load_tender")


# ── Agent server setup ────────────────────────────────────────
server = AgentServer()


def prewarm(proc: JobProcess):
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


@server.rtc_session(agent_name="my-agent")
async def my_agent(ctx: JobContext):
    ctx.log_context_fields = {"room": ctx.room.name}

    metadata_str = getattr(getattr(ctx, "job", None), "metadata", None)
    use_case = _resolve_use_case(ctx.room.name, metadata_str)
    logger.info("Room %s → use_case=%s", ctx.room.name, use_case)

    session = AgentSession(
        stt=inference.STT(model="deepgram/nova-3", language="multi"),
        tts=inference.TTS(
            model="cartesia/sonic-3",
            voice="9626c31c-bec5-4cca-baa8-f8ba9e84c8bc",
        ),
        turn_detection=MultilingualModel(),
        vad=ctx.proc.userdata["vad"],
        preemptive_generation=True,
    )

    agent = _PERSONA_MAP[use_case]()
    logger.info("Starting session with %s", type(agent).__name__)

    await session.start(
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

    await ctx.connect()


if __name__ == "__main__":
    cli.run_app(server)
