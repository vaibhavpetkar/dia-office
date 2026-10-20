"""Approval queue: risky actions are saved here instead of being executed.

Later this becomes a DynamoDB table + a dashboard button. For now it is data/approvals.json.
"""
from dia.records import add_record


def request_approval(action: str, details: dict) -> str:
    return add_record("approvals", {"action": action, "details": details, "status": "pending"})
