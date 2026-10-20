"""Sales Manager and its worker tools."""
from strands import Agent, tool

from dia.approvals import request_approval
from dia.models import worker_model

# ---- Level 4: tools (plain code, no AI) ----

FAKE_CRM = [
    {"name": "Asha Traders", "contact": "asha@example.com", "status": "new", "budget": "high"},
    {"name": "Ravi Foods", "contact": "ravi@example.com", "status": "contacted", "budget": "low"},
    {"name": "Nova Clinics", "contact": "nova@example.com", "status": "new", "budget": "medium"},
]


@tool
def list_leads(status: str = "new") -> list[dict]:
    """List leads from the CRM with the given status ("new", "contacted")."""
    return [lead for lead in FAKE_CRM if lead["status"] == status]


@tool
def send_email(to: str, subject: str, body: str) -> str:
    """Send an email to a customer. The email is queued for owner approval, not sent directly."""
    approval_id = request_approval("send_email", {"to": to, "subject": subject, "body": body})
    return f"Email queued for owner approval (approval id {approval_id})."


# ---- Level 3: worker agent ----

@tool
def outreach_writer(lead_name: str, product_info: str) -> str:
    """Worker agent: write a short, personal sales email for one lead."""
    writer = Agent(
        model=worker_model(),
        system_prompt=(
            "You write short, friendly B2B sales emails (under 120 words). "
            "Return the subject on the first line as 'Subject: ...', then the body."
        ),
        callback_handler=None,
    )
    return str(writer(f"Lead: {lead_name}\nProduct: {product_info}"))


# ---- Level 2: manager ----

@tool
def sales_manager(task: str) -> str:
    """Sales Manager: handles leads, outreach emails and sales follow-ups."""
    manager = Agent(
        model=worker_model(),
        system_prompt=(
            "You are the Sales Manager of Dia AI. Break the task into steps, "
            "use your tools and workers, check their output, then report back "
            "to the CEO with what was done and what is waiting for approval."
        ),
        tools=[list_leads, outreach_writer, send_email],
        callback_handler=None,
    )
    return str(manager(task))
