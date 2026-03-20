import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before importing the module under test
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => Buffer.from("fake-wav-data")),
}));

vi.mock("../src/server-manager.js", () => ({
  ensureServer: vi.fn(async () => "http://localhost:8099"),
}));

vi.mock("../src/audio-convert.js", () => ({
  convertAudio: vi.fn(async (buf: Buffer, target: string) => ({
    buffer: buf,
    format: target === "voice-note" ? "opus" : "mp3",
    extension: target === "voice-note" ? ".opus" : ".mp3",
    voiceCompatible: target === "voice-note",
  })),
}));

import { resolveChatterboxConfig, buildChatterboxSpeechProvider } from "../src/chatterbox-provider.js";
import { ensureServer } from "../src/server-manager.js";
import { convertAudio } from "../src/audio-convert.js";

// ---------------------------------------------------------------------------
// resolveChatterboxConfig
// ---------------------------------------------------------------------------

describe("resolveChatterboxConfig", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns defaults when no cfg or env vars", () => {
    delete process.env.CHATTERBOX_MODEL;
    delete process.env.CHATTERBOX_DEVICE;
    delete process.env.CHATTERBOX_PORT;
    delete process.env.CHATTERBOX_BASE_URL;

    const config = resolveChatterboxConfig();
    expect(config.model).toBe("turbo");
    expect(config.device).toBe("auto");
    expect(config.port).toBe(8099);
    expect(config.baseUrl).toBe("http://localhost:8099");
  });

  it("reads from env vars", () => {
    process.env.CHATTERBOX_MODEL = "standard";
    process.env.CHATTERBOX_DEVICE = "cuda";
    process.env.CHATTERBOX_PORT = "9000";
    process.env.CHATTERBOX_BASE_URL = "http://remote:9000";

    const config = resolveChatterboxConfig();
    expect(config.model).toBe("standard");
    expect(config.device).toBe("cuda");
    expect(config.port).toBe(9000);
    expect(config.baseUrl).toBe("http://remote:9000");
  });

  it("reads from cfg object with priority over env", () => {
    process.env.CHATTERBOX_MODEL = "standard";
    const cfg = {
      messages: {
        tts: {
          chatterbox: {
            model: "multilingual",
            port: 7000,
            temperature: 0.8,
          },
        },
      },
    } as any;

    const config = resolveChatterboxConfig(cfg);
    expect(config.model).toBe("multilingual");
    expect(config.port).toBe(7000);
    expect(config.temperature).toBe(0.8);
  });
});

// ---------------------------------------------------------------------------
// buildChatterboxSpeechProvider
// ---------------------------------------------------------------------------

describe("buildChatterboxSpeechProvider", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.CHATTERBOX_DISABLED;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const provider = buildChatterboxSpeechProvider();

  it("has correct id and label", () => {
    expect(provider.id).toBe("chatterbox");
    expect(provider.label).toBe("Chatterbox");
  });

  it("lists expected models", () => {
    expect(provider.models).toEqual(["turbo", "standard", "multilingual"]);
  });

  it("isConfigured returns true by default", () => {
    expect(provider.isConfigured({} as any)).toBeTruthy();
  });

  it("isConfigured returns false when CHATTERBOX_DISABLED is set", () => {
    process.env.CHATTERBOX_DISABLED = "1";
    expect(provider.isConfigured({} as any)).toBeFalsy();
  });

  it("listVoices returns default and clone entries", async () => {
    const voices = await provider.listVoices!({});
    expect(voices).toEqual([
      { id: "default", name: "Default" },
      { id: "clone", name: "Clone (reference audio)" },
    ]);
  });

  it("synthesize calls ensureServer and fetch with correct payload", async () => {
    const fakeResponse = {
      ok: true,
      json: async () => ({
        audio: Buffer.from("fake-audio").toString("base64"),
        sample_rate: 24000,
        format: "wav",
      }),
    };
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse));

    const result = await provider.synthesize({
      text: "Hello world",
      cfg: {} as any,
      config: {} as any,
      target: "audio-file",
    });

    expect(ensureServer).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8099/synthesize",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"text":"Hello world"'),
      }),
    );
    expect(result.outputFormat).toBe("mp3");
    expect(result.fileExtension).toBe(".mp3");
  });

  it("synthesize returns opus for voice-note target", async () => {
    const fakeResponse = {
      ok: true,
      json: async () => ({
        audio: Buffer.from("fake-audio").toString("base64"),
        sample_rate: 24000,
        format: "wav",
      }),
    };
    vi.stubGlobal("fetch", vi.fn(async () => fakeResponse));

    const result = await provider.synthesize({
      text: "Hello",
      cfg: {} as any,
      config: {} as any,
      target: "voice-note",
    });

    expect(result.outputFormat).toBe("opus");
    expect(result.fileExtension).toBe(".opus");
    expect(result.voiceCompatible).toBe(true);
  });

  it("synthesize throws on non-200 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      })),
    );

    await expect(
      provider.synthesize({
        text: "fail",
        cfg: {} as any,
        config: {} as any,
        target: "audio-file",
      }),
    ).rejects.toThrow("Chatterbox synthesis failed (500)");
  });
});
