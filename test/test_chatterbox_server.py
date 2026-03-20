"""Tests for the Chatterbox FastAPI server.

All heavy dependencies (torch, torchaudio, chatterbox) are mocked so
that the test suite runs without GPU libraries installed.
"""

from __future__ import annotations

import base64
import io
import os
import struct
import sys
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Mock heavy dependencies before importing the server
# ---------------------------------------------------------------------------

# Create a minimal fake tensor that supports .unsqueeze(0).cpu()
class _FakeTensor:
    """Minimal stand-in for a 1-D torch.Tensor."""

    def __init__(self, n: int = 24000):
        self._n = n

    def unsqueeze(self, dim: int):
        return self

    def cpu(self):
        return self


_fake_wav = _FakeTensor(24000)

_mock_model = MagicMock()
_mock_model.generate.return_value = _fake_wav

# Build a tiny valid WAV so base64-encoding round-trips work.
def _make_wav_bytes(n_samples: int = 100, sample_rate: int = 24000) -> bytes:
    """Return a minimal valid WAV file (16-bit mono PCM)."""
    data_size = n_samples * 2
    buf = io.BytesIO()
    buf.write(b"RIFF")
    buf.write(struct.pack("<I", 36 + data_size))
    buf.write(b"WAVE")
    buf.write(b"fmt ")
    buf.write(struct.pack("<IHHIIHH", 16, 1, 1, sample_rate, sample_rate * 2, 2, 16))
    buf.write(b"data")
    buf.write(struct.pack("<I", data_size))
    buf.write(b"\x00" * data_size)
    return buf.getvalue()


# Patch torchaudio.save to write our fake WAV bytes into the buffer
def _fake_torchaudio_save(buf, tensor, sample_rate, format=None):
    wav_bytes = _make_wav_bytes(sample_rate=sample_rate)
    buf.write(wav_bytes)


_mock_torch = MagicMock()
_mock_torch.cuda.is_available.return_value = False

_mock_torchaudio = MagicMock()
_mock_torchaudio.save.side_effect = _fake_torchaudio_save

_mock_tts_turbo = MagicMock()
_mock_tts_turbo.ChatterboxTurboTTS.from_pretrained.return_value = _mock_model

_mock_tts = MagicMock()
_mock_tts.ChatterboxTTS.from_pretrained.return_value = _mock_model

_mock_mtl_tts = MagicMock()
_mock_mtl_tts.ChatterboxMultilingualTTS.from_pretrained.return_value = _mock_model

# Inject mocks into sys.modules so the server import succeeds
sys.modules.setdefault("torch", _mock_torch)
sys.modules.setdefault("torchaudio", _mock_torchaudio)
sys.modules.setdefault("chatterbox", MagicMock())
sys.modules.setdefault("chatterbox.tts_turbo", _mock_tts_turbo)
sys.modules.setdefault("chatterbox.tts", _mock_tts)
sys.modules.setdefault("chatterbox.mtl_tts", _mock_mtl_tts)

# Now import the FastAPI app
from server.chatterbox_server import app  # noqa: E402

import server.chatterbox_server as _server_mod  # noqa: E402

from httpx import ASGITransport, AsyncClient  # noqa: E402

# Inject the mock model directly (lifespan doesn't run in test client)
_server_mod._model = _mock_model


@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.mark.anyio
async def test_health(client: AsyncClient):
    resp = await client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["model"] in ("turbo", "standard", "multilingual")
    assert "device" in body


@pytest.mark.anyio
async def test_synthesize_valid(client: AsyncClient):
    resp = await client.post("/synthesize", json={"text": "Hello world"})
    assert resp.status_code == 200
    body = resp.json()
    assert "audio" in body
    # Verify it's valid base64
    audio_bytes = base64.b64decode(body["audio"])
    assert len(audio_bytes) > 0
    assert body["sample_rate"] == 24000
    assert body["format"] == "wav"


@pytest.mark.anyio
async def test_synthesize_missing_text(client: AsyncClient):
    resp = await client.post("/synthesize", json={})
    assert resp.status_code == 422


@pytest.mark.anyio
async def test_synthesize_with_optional_params(client: AsyncClient):
    _mock_model.generate.reset_mock()
    resp = await client.post(
        "/synthesize",
        json={
            "text": "Test",
            "temperature": 0.7,
            "exaggeration": 0.5,
            "cfg_weight": 0.3,
        },
    )
    assert resp.status_code == 200
    call_kwargs = _mock_model.generate.call_args
    assert call_kwargs.kwargs.get("temperature") == 0.7
    assert call_kwargs.kwargs.get("exaggeration") == 0.5
    assert call_kwargs.kwargs.get("cfg_weight") == 0.3


@pytest.mark.anyio
async def test_model_variant_from_env():
    """Server uses the model variant set via CHATTERBOX_MODEL env var."""
    from server.chatterbox_server import MODEL_VARIANT

    assert MODEL_VARIANT == os.environ.get("CHATTERBOX_MODEL", "turbo")
