"""Level 1: the AI CEO. It plans and delegates to managers; it has no direct tools."""
from datetime import date

from strands import Agent

from dia.communication import communication_manager
from dia.creative import creative_manager
from dia.models import ceo_model
from dia.sales import sales_manager
from dia.support import support_manager

MANAGERS = [sales_manager, support_manager, creative_manager, communication_manager]

CEO_PROMPT = f"""You are the AI CEO of Dia AI. Today is {date.today():%A %Y-%m-%d}.
- Understand the owner's goal and make a short plan.
- Delegate each part to the right manager, with all details it needs. Never do department work yourself.
- Finish with a clear report: done, waiting for approval, and next steps.
Managers available: sales_manager, support_manager, creative_manager, communication_manager.
If a request needs a department that does not exist yet (engineering, finance, HR...), say so."""


def build_ceo() -> Agent:
    return Agent(model=ceo_model(), system_prompt=CEO_PROMPT, tools=MANAGERS)
