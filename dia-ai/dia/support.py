"""Support Manager and its worker tools."""
from pathlib import Path

from strands import Agent, tool

from dia.approvals import request_approval
from dia.models import worker_model
from dia.records import add_record

KNOWLEDGE_DIR = Path("knowledge")

# ---- Level 4: tools (plain code, no AI) ----


@tool
def search_knowledge(query: str) -> str:
    """Search the company knowledge base (FAQ, policies, product docs) for sections matching the query."""
    words = {w.lower() for w in query.split() if len(w) > 2}
    hits = []
    for doc in KNOWLEDGE_DIR.glob("*.md"):
        for section in doc.read_text(encoding="utf-8").split("\n## ")[1:]:
            score = sum(w in section.lower() for w in words)
            if score:
                hits.append((score, f"[{doc.name}] ## {section.strip()}"))
    hits.sort(reverse=True)
    return "\n\n".join(text for _, text in hits[:3]) or "No matching knowledge found."


@tool
def create_ticket(customer: str, summary: str, priority: str = "normal") -> str:
    """Create a support ticket. priority is "low", "normal" or "urgent"."""
    ticket_id = add_record("tickets", {"customer": customer, "summary": summary,
                                       "priority": priority, "status": "open"})
    return f"Ticket {ticket_id} created."


@tool
def escalate_to_human(customer: str, reason: str) -> str:
    """Hand the case to a human support person (refunds, angry customers, unknown answers)."""
    approval_id = request_approval("human_support", {"customer": customer, "reason": reason})
    return f"Escalated to the human team (id {approval_id})."


# ---- Level 3: worker agent ----


@tool
def support_answer_writer(question: str, knowledge: str) -> str:
    """Worker agent: write a reply to a customer using ONLY the given knowledge."""
    writer = Agent(
        model=worker_model(),
        system_prompt=(
            "You write short, polite customer support replies. Use ONLY the knowledge given. "
            "If the knowledge does not answer the question, reply exactly: NOT_FOUND"
        ),
        callback_handler=None,
    )
    return str(writer(f"Question: {question}\n\nKnowledge:\n{knowledge}"))


# ---- Level 2: manager ----


@tool
def support_manager(task: str) -> str:
    """Support Manager: answers customer questions, creates tickets and escalates hard cases."""
    manager = Agent(
        model=worker_model(),
        system_prompt=(
            "You are the Support Manager of Dia AI. For each customer question: "
            "search the knowledge base, have the writer draft a reply, and create a ticket. "
            "If the writer returns NOT_FOUND, or it is a refund/complaint, escalate to a human. "
            "Report back to the CEO with the reply and ticket/escalation ids."
        ),
        tools=[search_knowledge, support_answer_writer, create_ticket, escalate_to_human],
        callback_handler=None,
    )
    return str(manager(task))
