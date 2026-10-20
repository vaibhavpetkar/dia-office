"""Communication Manager: meetings, calendar, email/WhatsApp/SMS messages."""
import json
from datetime import date, datetime, timedelta

from strands import Agent, tool

from dia.approvals import request_approval
from dia.models import worker_model
from dia.records import DATA_DIR

CALENDAR_FILE = DATA_DIR / "calendar.json"

# ---- Level 4: tools (plain code, no AI) ----


def _load_calendar() -> list[dict]:
    return json.loads(CALENDAR_FILE.read_text(encoding="utf-8")) if CALENDAR_FILE.exists() else []


@tool
def check_calendar(day: str) -> list[dict]:
    """List meetings already booked on a day (YYYY-MM-DD)."""
    return [m for m in _load_calendar() if m["start"].startswith(day)]


@tool
def schedule_meeting(title: str, attendees: list[str], start: str, minutes: int = 30,
                     agenda: str = "") -> str:
    """Book a meeting. start is "YYYY-MM-DD HH:MM" (24h). Invites wait for owner approval before sending."""
    begin = datetime.strptime(start, "%Y-%m-%d %H:%M")
    end = begin + timedelta(minutes=minutes)
    for m in _load_calendar():
        m_begin = datetime.strptime(m["start"], "%Y-%m-%d %H:%M")
        if begin < m_begin + timedelta(minutes=m["minutes"]) and m_begin < end:
            return f"Time clash with '{m['title']}' at {m['start']}. Pick another time."

    meeting = {"title": title, "attendees": attendees, "start": start, "minutes": minutes, "agenda": agenda}
    CALENDAR_FILE.parent.mkdir(exist_ok=True)
    CALENDAR_FILE.write_text(json.dumps(_load_calendar() + [meeting], indent=2, ensure_ascii=False), encoding="utf-8")
    approval_id = request_approval("send_meeting_invites", meeting)
    return f"Meeting booked; invites waiting for owner approval (id {approval_id})."


@tool
def send_message(channel: str, to: str, text: str) -> str:
    """Send a message. channel is "email", "whatsapp", "sms" or "slack". Waits for owner approval."""
    if channel not in ("email", "whatsapp", "sms", "slack"):
        return f"Unknown channel '{channel}'."
    approval_id = request_approval("send_message", {"channel": channel, "to": to, "text": text})
    return f"{channel} message queued for owner approval (id {approval_id})."


# ---- Level 3: worker agents ----


@tool
def meeting_notes_writer(transcript: str) -> str:
    """Worker agent: turn a meeting transcript into a summary, decisions and action items."""
    writer = Agent(
        model=worker_model(),
        system_prompt=(
            "Summarize the meeting transcript as: Summary (3-5 lines), Decisions, "
            "Action items (owner - task - due date). Do not invent anything not in the transcript."
        ),
        callback_handler=None,
    )
    return str(writer(transcript))


@tool
def message_writer(purpose: str, channel: str) -> str:
    """Worker agent: write a message suited to the channel (formal email, short WhatsApp/SMS, Slack)."""
    writer = Agent(
        model=worker_model(),
        system_prompt=(
            "Write one business message for the given channel. Email: subject line + polite body. "
            "WhatsApp/SMS: under 300 characters, friendly. Slack: short and direct. Return only the message."
        ),
        callback_handler=None,
    )
    return str(writer(f"Channel: {channel}\nPurpose: {purpose}"))


# ---- Level 2: manager ----


@tool
def communication_manager(task: str) -> str:
    """Communication Manager: schedules meetings, writes meeting notes, sends email/WhatsApp/SMS/Slack messages."""
    manager = Agent(
        model=worker_model(),
        system_prompt=(
            f"You are the Communication Manager of Dia AI. Today is {date.today():%A %Y-%m-%d}. "
            "Before booking, check the calendar for that day. Use message_writer to draft messages, "
            "then send_message. Use meeting_notes_writer for transcripts. "
            "Report back to the CEO with what was booked/sent and the approval ids."
        ),
        tools=[check_calendar, schedule_meeting, send_message, meeting_notes_writer, message_writer],
        callback_handler=None,
    )
    return str(manager(task))
