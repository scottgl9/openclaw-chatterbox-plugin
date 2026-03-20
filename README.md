# OpenClaw Chatterbox TTS Plugin

A native local text-to-speech plugin for [OpenClaw](https://github.com/nicepkg/openclaw) using [Resemble AI's Chatterbox](https://github.com/resemble-ai/chatterbox) — an open-source (MIT) TTS system with zero-shot voice cloning support.

## Features

- **Zero-shot voice cloning** — provide a reference WAV file to clone any voice
- **Multiple model variants** — turbo (fast), standard, and multilingual
- **Fully local** — no cloud API keys required; runs entirely on your hardware
- **GPU accelerated** — automatic detection of CUDA and Apple MPS devices
- **Optional ffmpeg integration** — converts to mp3/opus when available, falls back to WAV

## Prerequisites

- **Python 3.10+** — `python3` or `python` must be on your PATH
- **PyTorch** — installed with appropriate CUDA/MPS support for your hardware
- **ffmpeg** (optional) — for mp3/opus output; WAV output works without it

## Installation

### 1. Install the Python server dependencies

```bash
pip install -r server/requirements.txt
```

Or install manually:

```bash
pip install chatterbox-tts fastapi 'uvicorn[standard]'
```

### 2. Install the plugin in OpenClaw

Copy or symlink this directory into your OpenClaw extensions folder, or add it as a dependency in your OpenClaw configuration.

## Configuration

Configuration is resolved in order of precedence: **OpenClaw config** → **environment variables** → **defaults**.

### OpenClaw Config

Add to your OpenClaw config under `messages.tts.chatterbox`:

```json
{
  "messages": {
    "tts": {
      "chatterbox": {
        "model": "turbo",
        "device": "auto",
        "port": 8099,
        "referenceAudio": "/path/to/reference.wav",
        "temperature": 1.0,
        "exaggeration": 1.0,
        "cfgWeight": 0.5
      }
    }
  }
}
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `CHATTERBOX_MODEL` | `turbo` | Model variant: `turbo`, `standard`, `multilingual` |
| `CHATTERBOX_DEVICE` | `auto` | PyTorch device: `auto`, `cuda`, `mps`, `cpu` |
| `CHATTERBOX_PORT` | `8099` | Port for the managed Python server |
| `CHATTERBOX_BASE_URL` | — | URL of an external Chatterbox server (skips local spawn) |
| `CHATTERBOX_REFERENCE_AUDIO` | — | Path to voice cloning reference WAV |
| `CHATTERBOX_TEMPERATURE` | — | Sampling temperature |
| `CHATTERBOX_EXAGGERATION` | — | Expressiveness exaggeration parameter |
| `CHATTERBOX_CFG_WEIGHT` | — | Classifier-free guidance weight |
| `CHATTERBOX_DISABLED` | — | Set to any value to disable the provider |

### Plugin Config Schema

The `openclaw.plugin.json` file defines the configuration schema for the plugin. See the file for the full list of configurable properties.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  OpenClaw                                           │
│  ┌───────────────┐    ┌──────────────────────────┐  │
│  │ Speech System │───▶│ Chatterbox Provider      │  │
│  └───────────────┘    │  (chatterbox-provider.ts)│  │
│                       └──────────┬───────────────┘  │
│                                  │                  │
│  ┌───────────────┐    ┌──────────▼───────────────┐  │
│  │ Audio Convert │◀───│ Server Manager           │  │
│  │ (ffmpeg)      │    │  (server-manager.ts)     │  │
│  └───────────────┘    └──────────┬───────────────┘  │
└──────────────────────────────────┼──────────────────┘
                                   │ HTTP (localhost)
                        ┌──────────▼───────────────┐
                        │ Python FastAPI Server     │
                        │  (chatterbox_server.py)   │
                        │  ┌─────────────────────┐  │
                        │  │ Chatterbox TTS Model │  │
                        │  └─────────────────────┘  │
                        └──────────────────────────┘
```

- **Plugin entry** (`index.ts`) registers the Chatterbox speech provider with OpenClaw
- **Speech provider** (`chatterbox-provider.ts`) handles synthesis requests, config resolution, and audio format conversion
- **Server manager** (`server-manager.ts`) lazily starts and manages the Python FastAPI server process
- **Audio convert** (`audio-convert.ts`) converts WAV output to mp3/opus via ffmpeg
- **Python server** (`chatterbox_server.py`) loads the Chatterbox model and exposes HTTP endpoints

## Voices

Chatterbox uses voice cloning rather than predefined voices:

- **Default** — uses the model's default voice
- **Clone (reference audio)** — clones the voice from a reference WAV file specified via `referenceAudio` config or `CHATTERBOX_REFERENCE_AUDIO` env var

## Running the Python Server Standalone

For development or debugging, you can run the server directly:

```bash
cd server
pip install -r requirements.txt
python chatterbox_server.py
```

Test with:

```bash
# Health check
curl http://localhost:8099/health

# Synthesize
curl -X POST http://localhost:8099/synthesize \
  -H 'Content-Type: application/json' \
  -d '{"text": "Hello world"}'
```

## Running Tests

### TypeScript tests (vitest)

```bash
npm install
npx vitest
```

### Python tests (pytest)

```bash
pip install pytest httpx anyio
pytest test/test_chatterbox_server.py
```

## License

MIT
