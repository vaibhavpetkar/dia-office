"""Model setup. CEO gets the strong model, workers get the cheaper/faster one.

DIA_PROVIDER picks where the AI runs:
- anthropic: the Anthropic API directly (console.anthropic.com). Needs ANTHROPIC_API_KEY.
- bedrock:   Amazon Bedrock. Claude Opus 5.5 / Sonnet 5.5 there are served by the Messages API
             endpoint (bedrock-mantle), so we use the Anthropic SDK's Bedrock Mantle client. It signs
             requests with your normal AWS credentials (aws configure).
- ollama:    free local models on your own PC (ollama.com). The managers call tools, so pick models
             that support tool calling, such as gpt-oss or qwen3.
"""
import os

from anthropic import AsyncAnthropicBedrockMantle
from strands.models import Model
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
    if provider() == "ollama":
        return value
    if provider() == "anthropic":
        return value.removeprefix("anthropic.")  # Bedrock IDs work too
    return value if value.startswith("anthropic.") or value == "test" else f"anthropic.{value}"


def _model(env_var: str) -> Model:
    if provider() == "ollama":
        from strands.models.ollama import OllamaModel
        # A bigger context window than Ollama's 4K default, so long conversations and tool results aren't cut off.
        return OllamaModel(os.environ.get("OLLAMA_URL", "http://localhost:11434"), model_id=model_id(env_var),
                           max_tokens=8000, keep_alive=os.environ.get("OLLAMA_KEEP_ALIVE", "30m"),
                           options={"num_ctx": int(os.environ.get("OLLAMA_NUM_CTX", "16384"))})
    if provider() == "anthropic":
        if not os.environ.get("ANTHROPIC_API_KEY") and model_id(env_var) != "test":
            raise SystemExit("Set ANTHROPIC_API_KEY in your .env file (see .env.example).")
        # The default client reads ANTHROPIC_API_KEY from the environment.
        return AnthropicModel(model_id=model_id(env_var), max_tokens=16000)
    if provider() != "bedrock":
        raise SystemExit(f"DIA_PROVIDER must be anthropic, bedrock or ollama, not {provider()!r}.")
    model = AnthropicModel(model_id=model_id(env_var), max_tokens=16000)
    model.client = AsyncAnthropicBedrockMantle(aws_region=region())
    return model


def ceo_model() -> Model:
    return _model("DIA_CEO_MODEL_ID")


def worker_model() -> Model:
    return _model("DIA_WORKER_MODEL_ID")
