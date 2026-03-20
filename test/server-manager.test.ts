import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ChildProcess } from "node:child_process";

// We need to mock child_process and fetch before importing
vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execSync: vi.fn(),
    spawn: vi.fn(() => {
      const proc = {
        on: vi.fn(),
        kill: vi.fn(),
        pid: 12345,
      };
      return proc;
    }),
  };
});

import { execSync, spawn } from "node:child_process";
import type { ChatterboxConfig } from "../src/types.js";

// Fresh import for each test module — server-manager has module-level state,
// so we re-import to reset it.
const { ensureServer, shutdownServer, findPython, checkChatterboxInstalled } = await import(
  "../src/server-manager.js"
);

function makeConfig(overrides: Partial<ChatterboxConfig> = {}): ChatterboxConfig {
  return {
    baseUrl: `http://localhost:8099`,
    model: "turbo",
    device: "auto",
    port: 8099,
    ...overrides,
  };
}

describe("server-manager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("findPython", () => {
    it("returns python3 when available", () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd === "python3 --version") return Buffer.from("Python 3.11.0");
        throw new Error("not found");
      });

      expect(findPython()).toBe("python3");
    });

    it("falls back to python when python3 unavailable", () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd === "python --version") return Buffer.from("Python 3.11.0");
        throw new Error("not found");
      });

      expect(findPython()).toBe("python");
    });

    it("throws when no python found", () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("not found");
      });

      expect(() => findPython()).toThrow("Python not found");
    });
  });

  describe("checkChatterboxInstalled", () => {
    it("does not throw when chatterbox is importable", () => {
      vi.mocked(execSync).mockReturnValue(Buffer.from(""));
      expect(() => checkChatterboxInstalled("python3")).not.toThrow();
    });

    it("throws with install instructions when chatterbox missing", () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("ModuleNotFoundError");
      });

      expect(() => checkChatterboxInstalled("python3")).toThrow(
        "Chatterbox TTS is not installed",
      );
    });
  });

  describe("ensureServer", () => {
    it("returns baseUrl directly when pointing to external server", async () => {
      const url = await ensureServer(
        makeConfig({ baseUrl: "http://remote-host:9000" }),
      );
      expect(url).toBe("http://remote-host:9000");
      expect(spawn).not.toHaveBeenCalled();
    });
  });

  describe("shutdownServer", () => {
    it("can be called safely when no server is running", () => {
      expect(() => shutdownServer()).not.toThrow();
    });
  });
});
