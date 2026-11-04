"""Model setup. CEO gets the strong model, workers get the cheaper/faster one.

DIA_PROVIDER picks where Claude runs:
- anthropic: the Anthropic API directly (console.anthropic.com). Needs ANTHROPIC_API_KEY.
- bedrock:   Amazon Bedrock. Claude Opus 5.5 / Sonnet 5.5 there are served by the Messages API
             endpoint (bedrock-mantle), so we use the Anthropic SDK's Bedrock Mantle client. It signs
             requests with your normal AWS credentials (aws configure).
             Inference-profile IDs (au./us./eu./apac./jp./global. or an ARN), e.g.
             au.anthropic.claude-opus-4-6-v1, go through the regular Bedrock runtime (InvokeModel)
             instead, because that is the only endpoint that serves them.
- openrouter: OpenRouter (openrouter.ai), one key for Claude, GPT, Gemini, DeepSeek, Llama and more,
             including free models (names ending in :free). Needs OPENROUTER_API_KEY.
"""
import os

from anthropic import AsyncAnthropicBedrock, AsyncAnthropicBedrockMantle
from strands.models import Model
from strands.models.anthropic import AnthropicModel

OPENROUTER_URL = "https://openrouter.ai/api/v1"


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
    if provider() == "openrouter":
        return value  # vendor/model as shown on openrouter.ai/models
    # Pass full Bedrock IDs through unchanged; only bare names like claude-opus-5-5 get "anthropic.".
    if value == "test" or "anthropic." in value or is_inference_profile(value):
        return value
    return f"anthropic.{value}"


def _openrouter(env_var: str) -> Model:
    from strands.models.openai import OpenAIModel  # needs: pip install "strands-agents[openai]"

    key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not key and model_id(env_var) != "test":
        raise SystemExit("Set OPENROUTER_API_KEY in your .env file (see .env.example).")
    fallbacks = [m.strip() for m in os.environ.get("OPENROUTER_FALLBACK_MODELS", "").split(",") if m.strip()][:2]
    params = {"max_tokens": 16000}
    if fallbacks:  # OpenRouter tries these when the first model is busy or out of free requests
        params["extra_body"] = {"models": [model_id(env_var), *fallbacks]}
    return OpenAIModel(
        client_args={"api_key": key or "test", "base_url": OPENROUTER_URL,
                     "default_headers": {"HTTP-Referer": "https://github.com/vaibhavpetkar/dia-office", "X-Title": "Dia AI"}},
        model_id=model_id(env_var), params=params)


def _model(env_var: str) -> Model:
    if provider() == "openrouter":
        return _openrouter(env_var)
    if provider() == "anthropic":
        if not os.environ.get("ANTHROPIC_API_KEY") and model_id(env_var) != "test":
            raise SystemExit("Set ANTHROPIC_API_KEY in your .env file (see .env.example).")
        # The default client reads ANTHROPIC_API_KEY from the environment.
        return AnthropicModel(model_id=model_id(env_var), max_tokens=16000)
    if provider() != "bedrock":
        raise SystemExit(f"DIA_PROVIDER must be anthropic, bedrock or openrouter, not {provider()!r}.")
    model = AnthropicModel(model_id=model_id(env_var), max_tokens=16000)
    if is_inference_profile(model_id(env_var)):
        model.client = AsyncAnthropicBedrock(aws_region=region())
    else:
        model.client = AsyncAnthropicBedrockMantle(aws_region=region())
    return model


def ceo_model() -> Model:
    return _model("DIA_CEO_MODEL_ID")


def worker_model() -> Model:
    return _model("DIA_WORKER_MODEL_ID")
