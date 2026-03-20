/**
 * Chatterbox speech provider for OpenClaw.
 */

import { readFileSync } from "node:fs";
import type { SpeechProviderPlugin, OpenClawConfig } from "openclaw/plugin-sdk/core";
import type {
  ChatterboxConfig,
  ChatterboxModel,
  ChatterboxDevice,
  ChatterboxSynthesizeRequest,
  ChatterboxSynthesizeResponse,
} from "./types.js";
import { ensureServer } from "./server-manager.js";
import { convertAudio } from "./audio-convert.js";

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

/**
 * Resolve Chatterbox configuration from the OpenClaw config object,
 * environment variables, and sensible defaults.
 *
 * Cascade: cfg.messages.tts.chatterbox.* → CHATTERBOX_* env → defaults
 */
export function resolveChatterboxConfig(cfg?: OpenClawConfig): ChatterboxConfig {
  const pluginCfg = (cfg as Record<string, any>)?.messages?.tts?.chatterbox as
    | Record<string, unknown>
    | undefined;

  const port = asNumber(pluginCfg?.port) ?? asNumber(process.env.CHATTERBOX_PORT) ?? 8099;

  return {
    baseUrl:
      asString(pluginCfg?.baseUrl) ??
      process.env.CHATTERBOX_BASE_URL ??
      `http://localhost:${port}`,
    model: (asString(pluginCfg?.model) ?? process.env.CHATTERBOX_MODEL ?? "turbo") as ChatterboxModel,
    device: (asString(pluginCfg?.device) ?? process.env.CHATTERBOX_DEVICE ?? "auto") as ChatterboxDevice,
    port,
    referenceAudio: asString(pluginCfg?.referenceAudio) ?? process.env.CHATTERBOX_REFERENCE_AUDIO,
    temperature: asNumber(pluginCfg?.temperature) ?? asNumber(process.env.CHATTERBOX_TEMPERATURE),
    exaggeration: asNumber(pluginCfg?.exaggeration) ?? asNumber(process.env.CHATTERBOX_EXAGGERATION),
    cfgWeight: asNumber(pluginCfg?.cfgWeight) ?? asNumber(process.env.CHATTERBOX_CFG_WEIGHT),
  };
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

export function buildChatterboxSpeechProvider(): SpeechProviderPlugin {
  return {
    id: "chatterbox",
    label: "Chatterbox",
    models: ["turbo", "standard", "multilingual"],
    voices: ["default", "clone"],

    isConfigured: () => {
      return !process.env.CHATTERBOX_DISABLED;
    },

    listVoices: async () => [
      { id: "default", name: "Default" },
      { id: "clone", name: "Clone (reference audio)" },
    ],

    synthesize: async (req) => {
      const config = resolveChatterboxConfig(req.cfg);
      const baseUrl = await ensureServer(config);

      // Build request payload
      const body: ChatterboxSynthesizeRequest = { text: req.text };

      if (config.referenceAudio) {
        const audioBytes = readFileSync(config.referenceAudio);
        body.reference_audio = audioBytes.toString("base64");
      }
      if (config.temperature !== undefined) body.temperature = config.temperature;
      if (config.exaggeration !== undefined) body.exaggeration = config.exaggeration;
      if (config.cfgWeight !== undefined) body.cfg_weight = config.cfgWeight;

      const res = await fetch(`${baseUrl}/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Chatterbox synthesis failed (${res.status}): ${text}`);
      }

      const data = (await res.json()) as ChatterboxSynthesizeResponse;
      const wavBuffer = Buffer.from(data.audio, "base64");

      const result = await convertAudio(wavBuffer, req.target);

      return {
        audioBuffer: result.buffer,
        outputFormat: result.format,
        fileExtension: result.extension,
        voiceCompatible: result.voiceCompatible,
      };
    },

    synthesizeTelephony: async (req) => {
      const config = resolveChatterboxConfig(req.cfg);
      const baseUrl = await ensureServer(config);

      const body: ChatterboxSynthesizeRequest = { text: req.text };
      if (config.referenceAudio) {
        const audioBytes = readFileSync(config.referenceAudio);
        body.reference_audio = audioBytes.toString("base64");
      }
      if (config.temperature !== undefined) body.temperature = config.temperature;
      if (config.exaggeration !== undefined) body.exaggeration = config.exaggeration;
      if (config.cfgWeight !== undefined) body.cfg_weight = config.cfgWeight;

      const res = await fetch(`${baseUrl}/synthesize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Chatterbox synthesis failed (${res.status}): ${text}`);
      }

      const data = (await res.json()) as ChatterboxSynthesizeResponse;
      const wavBuffer = Buffer.from(data.audio, "base64");

      return {
        audioBuffer: wavBuffer,
        outputFormat: "pcm",
        sampleRate: data.sample_rate,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}
