"""Owner approval desk.

  python approve.py               list pending actions
  python approve.py <id> yes      approve
  python approve.py <id> no       reject

Approving only marks the action for now; real sending is added when SES/WhatsApp are connected.
"""
import json
import sys

from dia.records import DATA_DIR

APPROVALS_FILE = DATA_DIR / "approvals.json"


def main() -> None:
    items = json.loads(APPROVALS_FILE.read_text(encoding="utf-8")) if APPROVALS_FILE.exists() else []
    if len(sys.argv) == 3:
        approval_id, answer = sys.argv[1], sys.argv[2].lower()
        for item in items:
            if item["id"] == approval_id and item["status"] == "pending":
                item["status"] = "approved" if answer in ("yes", "y") else "rejected"
                APPROVALS_FILE.write_text(json.dumps(items, indent=2, ensure_ascii=False), encoding="utf-8")
                print(f"{approval_id}: {item['status']}")
                return
        print(f"No pending action with id {approval_id}.")
        return

    pending = [i for i in items if i["status"] == "pending"]
    if not pending:
        print("Nothing waiting for approval.")
    for item in pending:
        print(f"\n[{item['id']}] {item['action']}")
        for key, value in item["details"].items():
            print(f"    {key}: {value}")


if __name__ == "__main__":
    main()
