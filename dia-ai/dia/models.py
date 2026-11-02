"""Model setup. CEO gets the strong model, workers get the cheaper/faster one.

DIA_PROVIDER picks where Claude runs:
- anthropic: the Anthropic API directly (console.anthropic.com). Needs ANTHROPIC_API_KEY.
- bedrock:   Amazon Bedrock. Claude Opus 5.5 / Sonnet 5.5 there are served by the Messages API
             endpoint (bedrock-mantle), so we use the Anthropic SDK's Bedrock Mantle client. It signs
             requests with your normal AWS credentials (aws configure).
             Inference-profile IDs (au./us./eu./apac./jp./global. or an ARN), e.g.
             au.anthropic.claude-opus-4-6-v1, go through the regular Bedrock runtime (InvokeModel)
             instead, because that is the only endpoint that serves them.
"""
import os

from anthropic import AsyncAnthropicBedrock, AsyncAnthropicBedrockMantle
from strands.models.anthropic import AnthropicModel


def provider() -> str:
    return os.environ.get("DIA_PROVIDER", "anthropic").strip().lower()


def region() -> str:
    return os.environ.get("AWS_REGION", "us-east-1")


# Cross-region inference profiles start with a geography, e.g. au.anthropic.claude-sonnet-4-6.
GEO_PREFIXES = ("us.", "eu.", "au.", "apac.", "jp.", "ca.", "us-gov.", "global.")


def is_inference_profile(model: str) -> bool:
    """True for IDs the Bedrock runtime serves (au.anthropic..., us.anthropic..., or a profile ARN)."""
    return model.startswith(GEO_PREFIXES) or model.startswith("arn:")


def model_id(env_var: str) -> str:
    """The model ID from .env, in the form the chosen provider expects."""
    value = os.environ.get(env_var, "").strip()
    if not value:
        raise SystemExit(f"Set {env_var} in your .env file (see .env.example).")
    if provider() == "anthropic":
        return value.removeprefix("anthropic.")  # Bedrock IDs work too
    # Pass full Bedrock IDs through unchanged; only bare names like claude-opus-5-5 get "anthropic.".
    if value == "test" or "anthropic." in value or is_inference_profile(value):
        return value
    return f"anthropic.{value}"


def _model(env_var: str) -> AnthropicModel:
    if provider() == "anthropic":
        if not os.environ.get("ANTHROPIC_API_KEY") and model_id(env_var) != "test":
            raise SystemExit("Set ANTHROPIC_API_KEY in your .env file (see .env.example).")
        # The default client reads ANTHROPIC_API_KEY from the environment.
        return AnthropicModel(model_id=model_id(env_var), max_tokens=16000)
    if provider() != "bedrock":
        raise SystemExit(f"DIA_PROVIDER must be anthropic or bedrock, not {provider()!r}.")
    model = AnthropicModel(model_id=model_id(env_var), max_tokens=16000)
    if is_inference_profile(model_id(env_var)):
        model.client = AsyncAnthropicBedrock(aws_region=region())
    else:
        model.client = AsyncAnthropicBedrockMantle(aws_region=region())
    return model


def ceo_model() -> AnthropicModel:
    return _model("DIA_CEO_MODEL_ID")


def worker_model() -> AnthropicModel:
    return _model("DIA_WORKER_MODEL_ID")
