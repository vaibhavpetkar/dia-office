"""Check that AWS + Bedrock are ready: python check_setup.py"""
import os

import boto3
from anthropic import AnthropicBedrockMantle
from dotenv import load_dotenv

load_dotenv()

# Strongest first. Used to find what this AWS account can use when the .env models fail.
CLAUDE_CANDIDATES = [
    "anthropic.claude-opus-5-5", "anthropic.claude-fable-5-1", "anthropic.claude-opus-5",
    "anthropic.claude-opus-4-8", "anthropic.claude-sonnet-5-5", "anthropic.claude-sonnet-5",
    "anthropic.claude-haiku-5-5", "anthropic.claude-haiku-4-5",
]
region = os.environ.get("AWS_REGION", "us-east-1")

try:
    arn = boto3.client("sts").get_caller_identity()["Arn"]
    print(f"[OK] AWS login works: {arn}")
except Exception as e:
    raise SystemExit(f"[FAIL] AWS login: {e}\n       Run 'aws configure' first.")

client = AnthropicBedrockMantle(aws_region=region)


def try_model(model_id: str) -> str | None:
    """Return None if the model answers, else a short error."""
    try:
        client.messages.create(model=model_id, max_tokens=1000,
                               messages=[{"role": "user", "content": "Reply with just: OK"}])
        return None
    except Exception as e:
        return str(e)


failed = False
for env_var in ("DIA_CEO_MODEL_ID", "DIA_WORKER_MODEL_ID"):
    model_id = os.environ.get(env_var)
    if not model_id:
        print(f"[FAIL] {env_var} is empty in .env")
        failed = True
        continue
    error = try_model(model_id)
    print(f"[OK] {env_var} ({model_id})" if error is None else f"[FAIL] {env_var} ({model_id}): {error[:200]}")
    failed |= error is not None

if failed:
    print("\nScanning which Claude models your account can use...")
    for candidate in CLAUDE_CANDIDATES:
        error = try_model(candidate)
        print(f"   {'[available]    ' if error is None else '[not available]'} {candidate}")
    print("Put available models into .env (CEO = strongest, worker = a cheaper one), then run this again.")
    print("\nFull error for anthropic.claude-sonnet-5 (open to all Bedrock customers):")
    print("  ", try_model("anthropic.claude-sonnet-5") or "no error")
    print("\nTesting the older Bedrock API (Converse) with Claude Sonnet 4.6:")
    try:
        boto3.client("bedrock-runtime", region_name=region).converse(
            modelId="us.anthropic.claude-sonnet-4-6",
            messages=[{"role": "user", "content": [{"text": "Reply with just: OK"}]}],
        )
        print("   [available] older API works - your account can use Claude.")
    except Exception as e:
        print(f"   [not available] {e}")

image_model = os.environ.get("DIA_IMAGE_MODEL_ID", "amazon.nova-canvas-v1:0")
try:
    image_models = boto3.client("bedrock", region_name=region).list_foundation_models(byOutputModality="IMAGE")
    ids = [m["modelId"] for m in image_models["modelSummaries"]]
    if image_model in ids:
        print(f"[OK] Image model {image_model}")
    else:
        print(f"[FAIL] Image model {image_model} not found in {region}. Image models here: {', '.join(ids) or 'none'}")
except Exception as e:
    print(f"[FAIL] Image model check: {e}")
