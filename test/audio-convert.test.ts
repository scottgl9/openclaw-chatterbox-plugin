import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process
vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execSync: vi.fn(),
    spawn: vi.fn(),
  };
});

import { execSync, spawn } from "node:child_process";
import { isFfmpegAvailable, convertAudio, resetFfmpegCache } from "../src/audio-convert.js";

describe("audio-convert", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFfmpegCache();
  });

  describe("isFfmpegAvailable", () => {
    it("returns true when ffmpeg is on PATH", () => {
      vi.mocked(execSync).mockReturnValue(Buffer.from("ffmpeg version 6.0"));
      expect(isFfmpegAvailable()).toBe(true);
    });

    it("returns false when ffmpeg is not found", () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("not found");
      });
      expect(isFfmpegAvailable()).toBe(false);
    });

    it("caches the result", () => {
      vi.mocked(execSync).mockReturnValue(Buffer.from("ffmpeg version 6.0"));
      isFfmpegAvailable();
      isFfmpegAvailable();
      expect(execSync).toHaveBeenCalledTimes(1);
    });
  });

  describe("convertAudio", () => {
    it("returns WAV passthrough when ffmpeg unavailable", async () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("not found");
      });

      const wavBuf = Buffer.from("RIFF....WAVEfmt ");
      const result = await convertAudio(wavBuf, "audio-file");

      expect(result.buffer).toBe(wavBuf);
      expect(result.format).toBe("wav");
      expect(result.extension).toBe(".wav");
      expect(result.voiceCompatible).toBe(false);
    });

    it("spawns ffmpeg with mp3 args for audio-file target", async () => {
      vi.mocked(execSync).mockReturnValue(Buffer.from("ffmpeg version 6.0"));

      const mockStdout = {
        on: vi.fn((event: string, cb: (data: Buffer) => void) => {
          if (event === "data") cb(Buffer.from("mp3-data"));
        }),
      };
      const mockStderr = { on: vi.fn() };
      const mockStdin = { write: vi.fn(), end: vi.fn() };
      const mockProc = {
        stdout: mockStdout,
        stderr: mockStderr,
        stdin: mockStdin,
        on: vi.fn((event: string, cb: (code: number) => void) => {
          if (event === "close") setTimeout(() => cb(0), 0);
        }),
      };
      vi.mocked(spawn).mockReturnValue(mockProc as any);

      const result = await convertAudio(Buffer.from("wav-data"), "audio-file");

      expect(spawn).toHaveBeenCalledWith(
        "ffmpeg",
        expect.arrayContaining(["-f", "mp3", "-c:a", "libmp3lame"]),
        expect.any(Object),
      );
      expect(result.format).toBe("mp3");
      expect(result.extension).toBe(".mp3");
      expect(result.voiceCompatible).toBe(false);
    });

    it("spawns ffmpeg with opus args for voice-note target", async () => {
      vi.mocked(execSync).mockReturnValue(Buffer.from("ffmpeg version 6.0"));

      const mockStdout = {
        on: vi.fn((event: string, cb: (data: Buffer) => void) => {
          if (event === "data") cb(Buffer.from("opus-data"));
        }),
      };
      const mockStderr = { on: vi.fn() };
      const mockStdin = { write: vi.fn(), end: vi.fn() };
      const mockProc = {
        stdout: mockStdout,
        stderr: mockStderr,
        stdin: mockStdin,
        on: vi.fn((event: string, cb: (code: number) => void) => {
          if (event === "close") setTimeout(() => cb(0), 0);
        }),
      };
      vi.mocked(spawn).mockReturnValue(mockProc as any);

      const result = await convertAudio(Buffer.from("wav-data"), "voice-note");

      expect(spawn).toHaveBeenCalledWith(
        "ffmpeg",
        expect.arrayContaining(["-f", "opus", "-c:a", "libopus"]),
        expect.any(Object),
      );
      expect(result.format).toBe("opus");
      expect(result.extension).toBe(".opus");
      expect(result.voiceCompatible).toBe(true);
    });

    it("rejects when ffmpeg process exits with error", async () => {
      vi.mocked(execSync).mockReturnValue(Buffer.from("ffmpeg version 6.0"));

      const mockStdout = { on: vi.fn() };
      const mockStderr = { on: vi.fn() };
      const mockStdin = { write: vi.fn(), end: vi.fn() };
      const mockProc = {
        stdout: mockStdout,
        stderr: mockStderr,
        stdin: mockStdin,
        on: vi.fn((event: string, cb: (code: number) => void) => {
          if (event === "close") setTimeout(() => cb(1), 0);
        }),
      };
      vi.mocked(spawn).mockReturnValue(mockProc as any);

      await expect(convertAudio(Buffer.from("bad"), "audio-file")).rejects.toThrow(
        "ffmpeg exited with code 1",
      );
    });
  });
});
