"""Model setup. CEO gets the strong model, workers get the cheaper/faster one.

DIA_PROVIDER picks where Claude runs:
- anthropic: the Anthropic API directly (console.anthropic.com). Needs ANTHROPIC_API_KEY.
- bedrock:   Amazon Bedrock. Claude Opus 5.5 / Sonnet 5.5 there are served by the Messages API
             endpoint (bedrock-mantle), so we use the Anthropic SDK's Bedrock Mantle client. It signs
             requests with your normal AWS credentials (aws configure).
"""
import os

from anthropic import AsyncAnthropicBedrockMantle
from strands.models.anthropic import AnthropicModel


def provider() -> str:
    return os.environ.get("DIA_PROVIDER", "anthropic").strip().lower()


def region() -> str:
    return os.environ.get("AWS_REGION", "us-east-1")


def model_id(env_var: str) -> str:
    """The model ID from .env, in the form the chosen provider expects."""
    value = os.environ.get(env_var, "").strip()
    if not value:
        raise SystemExit(f"Set {env_var} in your .env file (see .env.example).")
    if provider() == "anthropic":
        return value.removeprefix("anthropic.")  # Bedrock IDs work too
    return value if value.startswith("anthropic.") or value == "test" else f"anthropic.{value}"


def _model(env_var: str) -> AnthropicModel:
    if provider() == "anthropic":
        if not os.environ.get("ANTHROPIC_API_KEY") and model_id(env_var) != "test":
            raise SystemExit("Set ANTHROPIC_API_KEY in your .env file (see .env.example).")
        # The default client reads ANTHROPIC_API_KEY from the environment.
        return AnthropicModel(model_id=model_id(env_var), max_tokens=16000)
    if provider() != "bedrock":
        raise SystemExit(f"DIA_PROVIDER must be anthropic or bedrock, not {provider()!r}.")
    model = AnthropicModel(model_id=model_id(env_var), max_tokens=16000)
    model.client = AsyncAnthropicBedrockMantle(aws_region=region())
    return model


def ceo_model() -> AnthropicModel:
    return _model("DIA_CEO_MODEL_ID")


def worker_model() -> AnthropicModel:
    return _model("DIA_WORKER_MODEL_ID")
