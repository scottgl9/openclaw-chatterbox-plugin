"""FastAPI server wrapping Chatterbox TTS models."""

from __future__ import annotations

import base64
import io
import os
from contextlib import asynccontextmanager
from typing import Optional

import torch
import torchaudio
from fastapi import FastAPI
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Configuration from environment
# ---------------------------------------------------------------------------

MODEL_VARIANT = os.environ.get("CHATTERBOX_MODEL", "turbo")
DEVICE = os.environ.get("CHATTERBOX_DEVICE", "auto")
PORT = int(os.environ.get("CHATTERBOX_PORT", "8099"))

# ---------------------------------------------------------------------------
# Model loading helpers
# ---------------------------------------------------------------------------

_model = None


def _resolve_device() -> str:
    if DEVICE != "auto":
        return DEVICE
    if torch.cuda.is_available():
        return "cuda"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _load_model(device: str):
    if MODEL_VARIANT == "turbo":
        from chatterbox.tts_turbo import ChatterboxTurboTTS

        return ChatterboxTurboTTS.from_pretrained(device=device)
    elif MODEL_VARIANT == "standard":
        from chatterbox.tts import ChatterboxTTS

        return ChatterboxTTS.from_pretrained(device=device)
    elif MODEL_VARIANT == "multilingual":
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS

        return ChatterboxMultilingualTTS.from_pretrained(device=device)
    else:
        raise ValueError(f"Unknown model variant: {MODEL_VARIANT}")


# ---------------------------------------------------------------------------
# FastAPI lifespan – load model once at startup
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _model
    device = _resolve_device()
    _model = _load_model(device)
    yield


app = FastAPI(lifespan=lifespan)

# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class SynthesizeRequest(BaseModel):
    text: str
    reference_audio: Optional[str] = None  # base64-encoded WAV
    temperature: Optional[float] = None
    exaggeration: Optional[float] = None
    cfg_weight: Optional[float] = None


class SynthesizeResponse(BaseModel):
    audio: str  # base64-encoded WAV
    sample_rate: int
    format: str


class HealthResponse(BaseModel):
    status: str
    model: str
    device: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok",
        model=MODEL_VARIANT,
        device=str(_resolve_device()),
    )


@app.post("/synthesize", response_model=SynthesizeResponse)
async def synthesize(req: SynthesizeRequest):
    kwargs: dict = {}
    if req.temperature is not None:
        kwargs["temperature"] = req.temperature
    if req.exaggeration is not None:
        kwargs["exaggeration"] = req.exaggeration
    if req.cfg_weight is not None:
        kwargs["cfg_weight"] = req.cfg_weight

    # Handle optional reference audio for voice cloning
    ref_audio_path = None
    if req.reference_audio:
        import tempfile

        ref_bytes = base64.b64decode(req.reference_audio)
        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        tmp.write(ref_bytes)
        tmp.close()
        ref_audio_path = tmp.name

    try:
        wav = _model.generate(req.text, audio_prompt_path=ref_audio_path, **kwargs)
    finally:
        if ref_audio_path:
            os.unlink(ref_audio_path)

    # Encode output to base64 WAV
    sample_rate = 24000
    buf = io.BytesIO()
    torchaudio.save(buf, wav.unsqueeze(0).cpu(), sample_rate, format="wav")
    audio_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    return SynthesizeResponse(
        audio=audio_b64,
        sample_rate=sample_rate,
        format="wav",
    )


# ---------------------------------------------------------------------------
# Standalone entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
