"""Check that the AI is ready: python check_setup.py

DIA_PROVIDER=anthropic checks your Anthropic API key; DIA_PROVIDER=bedrock checks AWS + Bedrock.
"""
import os

from dotenv import load_dotenv

load_dotenv()

from dia.models import model_id, provider, region  # noqa: E402

# Strongest first. Used to find what this account can use when the .env models fail.
CLAUDE_CANDIDATES = [
    "claude-opus-5-5", "claude-fable-5-1", "claude-opus-5", "claude-opus-4-8",
    "claude-sonnet-5-5", "claude-sonnet-5", "claude-haiku-5-5", "claude-haiku-4-5",
]


def make_client():
    if provider() == "anthropic":
        key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
        if not key or key.startswith("paste-"):
            raise SystemExit("[FAIL] ANTHROPIC_API_KEY is empty in .env.\n"
                             "       Create a key at https://console.anthropic.com/settings/keys and paste it into .env.")
        if not key.startswith("sk-ant-"):
            print("[WARN] ANTHROPIC_API_KEY does not start with sk-ant- . Check you copied the whole key.")
        from anthropic import Anthropic
        print(f"[OK] Using the Anthropic API (key ending ...{key[-4:]})")
        return Anthropic()

    import boto3
    from anthropic import AnthropicBedrockMantle
    try:
        arn = boto3.client("sts").get_caller_identity()["Arn"]
        print(f"[OK] AWS login works: {arn}")
    except Exception as e:
        raise SystemExit(f"[FAIL] AWS login: {e}\n       Run 'aws configure' first.")
    return AnthropicBedrockMantle(aws_region=region())


client = make_client()


def try_model(model: str) -> str | None:
    """Return None if the model answers, else a short error."""
    try:
        client.messages.create(model=model, max_tokens=1000,
                               messages=[{"role": "user", "content": "Reply with just: OK"}])
        return None
    except Exception as e:
        return str(e)


failed = False
for env_var in ("DIA_CEO_MODEL_ID", "DIA_WORKER_MODEL_ID"):
    if not os.environ.get(env_var):
        print(f"[FAIL] {env_var} is empty in .env")
        failed = True
        continue
    model = model_id(env_var)
    error = try_model(model)
    print(f"[OK] {env_var} ({model})" if error is None else f"[FAIL] {env_var} ({model}): {error[:300]}")
    failed |= error is not None

if failed:
    print("\nScanning which Claude models your account can use...")
    prefix = "anthropic." if provider() == "bedrock" else ""
    for candidate in CLAUDE_CANDIDATES:
        error = try_model(prefix + candidate)
        print(f"   {'[available]    ' if error is None else '[not available]'} {prefix}{candidate}")
    print("Put available models into .env (CEO = strongest, worker = a cheaper one), then run this again.")
    if provider() == "anthropic":
        print("A 401 error means the key is wrong; 'credit balance is too low' means add credits under "
              "console.anthropic.com -> Billing.")

if os.environ.get("DIA_IMAGE_PROVIDER", "off").strip().lower() != "bedrock":
    print("[INFO] Image generation is off. The Creative team writes image briefs instead of pictures.\n"
          "       (The Anthropic API has no image model. Set DIA_IMAGE_PROVIDER=bedrock once Bedrock works.)")
else:
    import boto3
    image_model = os.environ.get("DIA_IMAGE_MODEL_ID", "amazon.nova-canvas-v1:0")
    try:
        image_models = boto3.client("bedrock", region_name=region()).list_foundation_models(byOutputModality="IMAGE")
        ids = [m["modelId"] for m in image_models["modelSummaries"]]
        if image_model in ids:
            print(f"[OK] Image model {image_model}")
        else:
            print(f"[FAIL] Image model {image_model} not found in {region()}. Image models here: {', '.join(ids) or 'none'}")
    except Exception as e:
        print(f"[FAIL] Image model check: {e}")
