"""Tiny JSON-file storage. Later this becomes DynamoDB tables."""
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

DATA_DIR = Path(os.environ.get("DIA_DATA_DIR", "data"))


def add_record(table: str, record: dict) -> str:
    path = DATA_DIR / f"{table}.json"
    DATA_DIR.mkdir(exist_ok=True)
    items = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
    record_id = uuid.uuid4().hex[:8]
    items.append({"id": record_id, **record, "created_at": datetime.now(timezone.utc).isoformat()})
    path.write_text(json.dumps(items, indent=2, ensure_ascii=False), encoding="utf-8")
    return record_id
