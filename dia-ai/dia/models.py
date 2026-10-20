"""Model setup. CEO gets the strong model, workers get the cheaper/faster one.

Claude Opus 5.5 / Sonnet 5.5 on Bedrock are served by the Messages API endpoint
(bedrock-mantle), not the Converse API, so we use the Anthropic SDK's Bedrock Mantle
client. It signs requests with your normal AWS credentials (aws configure).
"""
import os

from anthropic import AsyncAnthropicBedrockMantle
from strands.models.anthropic import AnthropicModel


def region() -> str:
    return os.environ.get("AWS_REGION", "us-east-1")


def _model(env_var: str) -> AnthropicModel:
    model_id = os.environ.get(env_var)
    if not model_id:
        raise SystemExit(f"Set {env_var} in your .env file (see .env.example).")
    model = AnthropicModel(model_id=model_id, max_tokens=16000)
    model.client = AsyncAnthropicBedrockMantle(aws_region=region())
    return model


def ceo_model() -> AnthropicModel:
    return _model("DIA_CEO_MODEL_ID")


def worker_model() -> AnthropicModel:
    return _model("DIA_WORKER_MODEL_ID")
