/**
 * Manages the lifecycle of the Python Chatterbox TTS server.
 */

import { spawn, execSync, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { ChatterboxConfig, ChatterboxHealthResponse } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_SCRIPT = join(__dirname, "..", "server", "chatterbox_server.py");

let serverProcess: ChildProcess | null = null;
let serverUrl: string | null = null;

/** Maximum time (ms) to wait for the server to become healthy. */
const HEALTH_TIMEOUT_MS = 120_000;

/** Interval (ms) between health-check polls. */
const HEALTH_POLL_INTERVAL_MS = 1_000;

// ---------------------------------------------------------------------------
// Python detection
// ---------------------------------------------------------------------------

function findPython(): string {
  for (const bin of ["python3", "python"]) {
    try {
      execSync(`${bin} --version`, { stdio: "ignore" });
      return bin;
    } catch {
      // try next
    }
  }
  throw new Error(
    "Python not found. Install Python 3.10+ and ensure `python3` or `python` is on your PATH.",
  );
}

function checkChatterboxInstalled(pythonBin: string): void {
  try {
    execSync(`${pythonBin} -c "import chatterbox"`, { stdio: "ignore" });
  } catch {
    throw new Error(
      "Chatterbox TTS is not installed. Run:\n" +
        `  ${pythonBin} -m pip install chatterbox-tts fastapi 'uvicorn[standard]'\n` +
        "or install from the plugin's requirements:\n" +
        `  ${pythonBin} -m pip install -r server/requirements.txt`,
    );
  }
}

// ---------------------------------------------------------------------------
// Health polling
// ---------------------------------------------------------------------------

async function waitForHealth(url: string): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  const healthUrl = `${url}/health`;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl);
      if (res.ok) {
        const body = (await res.json()) as ChatterboxHealthResponse;
        if (body.status === "ok") return;
      }
    } catch {
      // server not ready yet
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
  }

  throw new Error(
    `Chatterbox server did not become healthy within ${HEALTH_TIMEOUT_MS / 1000}s. ` +
      "The first launch downloads model weights which can take a while. " +
      "Check the server logs for errors.",
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ensure the Chatterbox server is running and return its base URL.
 * If `config.baseUrl` points to an external server, that URL is returned
 * directly without spawning a child process.
 */
export async function ensureServer(config: ChatterboxConfig): Promise<string> {
  // External server — skip spawn
  if (config.baseUrl && !config.baseUrl.includes(`localhost:${config.port}`)) {
    return config.baseUrl;
  }

  // Already running
  if (serverProcess && serverUrl) {
    return serverUrl;
  }

  const pythonBin = findPython();
  checkChatterboxInstalled(pythonBin);

  const url = `http://localhost:${config.port}`;

  serverProcess = spawn(pythonBin, [SERVER_SCRIPT], {
    env: {
      ...process.env,
      CHATTERBOX_MODEL: config.model,
      CHATTERBOX_DEVICE: config.device,
      CHATTERBOX_PORT: String(config.port),
    },
    stdio: "ignore",
    detached: false,
  });

  serverProcess.on("error", (err) => {
    console.error("[chatterbox] server process error:", err);
    serverProcess = null;
    serverUrl = null;
  });

  serverProcess.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[chatterbox] server exited with code ${code}`);
    }
    serverProcess = null;
    serverUrl = null;
  });

  await waitForHealth(url);
  serverUrl = url;
  return url;
}

/** Kill the managed server process if running. */
export function shutdownServer(): void {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
    serverUrl = null;
  }
}

// Clean up on process exit
process.on("exit", shutdownServer);

// Exported for testing
export { findPython, checkChatterboxInstalled, waitForHealth };
