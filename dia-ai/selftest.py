"""Offline self-test: checks the install and all tools WITHOUT AWS or AI. python selftest.py"""
import base64
import io
import json
import os
import tempfile
from unittest import mock

os.environ["DIA_DATA_DIR"] = tempfile.mkdtemp()  # test data goes to a temp folder, not data/
os.environ.setdefault("DIA_CEO_MODEL_ID", "test")
os.environ.setdefault("DIA_WORKER_MODEL_ID", "test")
os.environ["DIA_IMAGE_PROVIDER"] = "bedrock"  # the image test uses a fake Bedrock client

from dia.ceo import build_ceo  # noqa: E402
from dia.communication import check_calendar, schedule_meeting, send_message  # noqa: E402
from dia.creative import generate_image  # noqa: E402
from dia.sales import list_leads, send_email  # noqa: E402
from dia.support import create_ticket, escalate_to_human, search_knowledge  # noqa: E402

failures = 0


def check(name: str, ok: bool) -> None:
    global failures
    failures += not ok
    print(f"[{'OK' if ok else 'FAIL'}] {name}")


check("CEO has 4 managers", len(build_ceo().tool_names) == 4)
check("Sales: list leads", len(list_leads(status="new")) == 2)
check("Sales: email goes to approval", "approval" in send_email(to="a@x.com", subject="Hi", body="Test"))
check("Support: knowledge search", "Forgot password" in search_knowledge(query="reset password"))
check("Support: create ticket", "created" in create_ticket(customer="Asha", summary="login issue"))
check("Support: escalate", "Escalated" in escalate_to_human(customer="Ravi", reason="refund"))
check("Communication: book meeting", "booked" in schedule_meeting(title="Sync", attendees=["a@x.com"], start="2030-01-07 11:00", minutes=60))
check("Communication: clash detected", "clash" in schedule_meeting(title="Other", attendees=["b@x.com"], start="2030-01-07 11:30"))
check("Communication: calendar", len(check_calendar(day="2030-01-07")) == 1)
check("Communication: message approval", "approval" in send_message(channel="whatsapp", to="+910000000000", text="Hi"))

fake_png = base64.b64encode(b"\x89PNG test").decode()
fake_bedrock = mock.MagicMock()
fake_bedrock.invoke_model.return_value = {"body": io.BytesIO(json.dumps({"images": [fake_png]}).encode())}
with mock.patch("boto3.client", return_value=fake_bedrock):
    check("Creative: image saved (fake model)", "Saved images" in generate_image(prompt="red shoe"))
os.environ["DIA_IMAGE_PROVIDER"] = "openrouter"
fake_reply = mock.MagicMock()
fake_reply.__enter__.return_value.read.return_value = json.dumps({"choices": [{"message": {"images": [
    {"image_url": {"url": "data:image/png;base64," + fake_png}}]}}]}).encode()
with mock.patch("urllib.request.urlopen", return_value=fake_reply):
    check("Creative: OpenRouter image saved (fake model)", "Saved images" in generate_image(prompt="red shoe"))
os.environ["DIA_IMAGE_PROVIDER"] = "off"
check("Creative: images off gives a brief", "Image brief" in generate_image(prompt="red shoe"))

from dia import models  # noqa: E402
with mock.patch.dict(os.environ, {"DIA_PROVIDER": "openrouter", "OPENROUTER_API_KEY": "sk-or-test",
                                  "DIA_CEO_MODEL_ID": "deepseek/deepseek-chat-v3-0324:free",
                                  "OPENROUTER_FALLBACK_MODELS": "qwen/qwen3-coder:free"}):
    m = models.ceo_model()
    check("OpenRouter: CEO model set up", m.config["model_id"] == "deepseek/deepseek-chat-v3-0324:free"
          and m.config["params"]["extra_body"]["models"][1] == "qwen/qwen3-coder:free")

print("\nAll good! Next: fill .env, run check_setup.py, then main.py" if not failures
      else f"\n{failures} check(s) failed - send this output to Claude.")
raise SystemExit(1 if failures else 0)
