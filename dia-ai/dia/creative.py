"""Creative Manager and its worker tools."""
import base64
import json
import os
import urllib.request
import uuid

import boto3
from strands import Agent, tool

from dia.models import worker_model
from dia.records import DATA_DIR

IMAGES_DIR = DATA_DIR / "images"
MAX_IMAGES_PER_CALL = 4

# ---- Level 4: tools (plain code, no AI) ----


@tool
def generate_image(prompt: str, count: int = 1, width: int = 1024, height: int = 1024,
                   avoid: str = "blurry, distorted text, watermark") -> str:
    """Generate high-quality images from a detailed English prompt (max 1000 characters).
    count is 1-4. width/height must be multiples of 64 (e.g. 1024x1024 square, 1280x720 banner).
    avoid lists things that must NOT appear in the image."""
    count = max(1, min(count, MAX_IMAGES_PER_CALL))
    image_provider = os.environ.get("DIA_IMAGE_PROVIDER", "off").strip().lower()
    if image_provider == "local":
        return _local_images(prompt, count, width, height, avoid)
    if image_provider != "bedrock":
        # Claude (Anthropic API) can't draw pictures, so without an image model we hand back the prompt.
        return ("Image generation is off (set DIA_IMAGE_PROVIDER=local for Stable Diffusion on this PC, or bedrock "
                f"for Amazon Nova Canvas). Image brief for a designer: {prompt[:1000]} | Avoid: {avoid}")
    model_id = os.environ.get("DIA_IMAGE_MODEL_ID", "amazon.nova-canvas-v1:0")
    client = boto3.client("bedrock-runtime", region_name=os.environ.get("AWS_REGION", "us-east-1"))
    response = client.invoke_model(modelId=model_id, body=json.dumps({
        "taskType": "TEXT_IMAGE",
        "textToImageParams": {"text": prompt[:1000], "negativeText": avoid[:1000]},
        "imageGenerationConfig": {"numberOfImages": count, "width": width, "height": height,
                                  "quality": "premium", "cfgScale": 7.0},
    }))
    result = json.loads(response["body"].read())
    if result.get("error"):
        return f"Image generation failed: {result['error']}"
    return _save(result["images"])


def _local_images(prompt: str, count: int, width: int, height: int, avoid: str) -> str:
    """Stable Diffusion WebUI Forge (or AUTOMATIC1111) running on this PC, started with --api. Free."""
    url = os.environ.get("SD_URL", "http://127.0.0.1:7860")
    request = urllib.request.Request(f"{url}/sdapi/v1/txt2img", headers={"Content-Type": "application/json"},
                                     data=json.dumps({"prompt": prompt[:1500], "negative_prompt": avoid[:1000],
                                                      "batch_size": count, "width": width, "height": height,
                                                      "steps": int(os.environ.get("SD_STEPS", "25")),
                                                      "cfg_scale": 6}).encode())
    try:
        with urllib.request.urlopen(request, timeout=600) as response:
            result = json.loads(response.read())
    except OSError as e:
        return f"Image generation failed: Stable Diffusion is not answering at {url} ({e}). Start Forge with --api."
    images = result.get("images")
    return _save(images) if images else "Image generation failed: no image returned."


def _save(images_b64: list[str]) -> str:
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    paths = []
    for image_b64 in images_b64:
        path = IMAGES_DIR / f"{uuid.uuid4().hex[:8]}.png"
        path.write_bytes(base64.b64decode(image_b64))
        paths.append(str(path))
    return "Saved images: " + ", ".join(paths)


# ---- Level 3: worker agents ----


@tool
def image_prompt_writer(request: str, brand_style: str = "") -> str:
    """Worker agent: turn a simple image request into a detailed, high-quality image prompt."""
    writer = Agent(
        model=worker_model(),
        system_prompt=(
            "You write prompts for an image-generation model. Describe subject, setting, "
            "composition, lighting, colors, camera/style and mood in one paragraph under 800 characters. "
            "Avoid asking for readable text inside the image. Return only the prompt."
        ),
        callback_handler=None,
    )
    return str(writer(f"Request: {request}\nBrand style: {brand_style or 'modern, clean, professional'}"))


@tool
def content_writer(brief: str) -> str:
    """Worker agent: write marketing copy (social posts, captions, ad text) from a brief."""
    writer = Agent(
        model=worker_model(),
        system_prompt="You write short, catchy marketing copy. Give 2-3 options with hashtags where useful.",
        callback_handler=None,
    )
    return str(writer(brief))


# ---- Level 2: manager ----


@tool
def creative_manager(task: str) -> str:
    """Creative Manager: marketing images, product visuals, social media posts and ad copy."""
    manager = Agent(
        model=worker_model(),
        system_prompt=(
            "You are the Creative Manager of Dia AI. For images: ALWAYS have image_prompt_writer "
            "write the prompt first, then call generate_image with it. For text: use content_writer. "
            "Report back to the CEO with the saved image paths and the copy."
        ),
        tools=[image_prompt_writer, generate_image, content_writer],
        callback_handler=None,
    )
    return str(manager(task))
