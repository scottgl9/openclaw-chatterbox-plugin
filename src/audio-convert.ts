/**
 * Audio format conversion utilities using ffmpeg.
 */

import { execSync, spawn } from "node:child_process";

/** Matches openclaw's SpeechSynthesisTarget. */
type SpeechSynthesisTarget = "audio-file" | "voice-note";

let _ffmpegAvailable: boolean | undefined;

/** Check whether ffmpeg is on the PATH. Result is cached. */
export function isFfmpegAvailable(): boolean {
  if (_ffmpegAvailable === undefined) {
    try {
      execSync("ffmpeg -version", { stdio: "ignore" });
      _ffmpegAvailable = true;
    } catch {
      _ffmpegAvailable = false;
    }
  }
  return _ffmpegAvailable;
}

/** Reset the cached ffmpeg detection (for testing). */
export function resetFfmpegCache(): void {
  _ffmpegAvailable = undefined;
}

type ConvertResult = {
  buffer: Buffer;
  format: string;
  extension: string;
  voiceCompatible: boolean;
};

/**
 * Convert a WAV buffer to the format appropriate for the given target.
 *
 * - `voice-note` → opus  (voiceCompatible: true)
 * - `audio-file` → mp3
 *
 * If ffmpeg is not available, returns the WAV buffer as-is.
 */
export async function convertAudio(
  wavBuffer: Buffer,
  target: SpeechSynthesisTarget,
): Promise<ConvertResult> {
  if (!isFfmpegAvailable()) {
    return {
      buffer: wavBuffer,
      format: "wav",
      extension: ".wav",
      voiceCompatible: false,
    };
  }

  const isVoiceNote = target === "voice-note";
  const outputFormat = isVoiceNote ? "opus" : "mp3";

  const ffmpegArgs = [
    "-f",
    "wav",
    "-i",
    "pipe:0",
    "-f",
    outputFormat,
    ...(isVoiceNote ? ["-c:a", "libopus", "-b:a", "64k"] : ["-c:a", "libmp3lame", "-b:a", "128k"]),
    "pipe:1",
  ];

  const buffer = await runFfmpeg(ffmpegArgs, wavBuffer);

  return {
    buffer,
    format: outputFormat,
    extension: isVoiceNote ? ".opus" : ".mp3",
    voiceCompatible: isVoiceNote,
  };
}

function runFfmpeg(args: string[], input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];

    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    proc.stderr.on("data", () => {
      /* discard ffmpeg stderr */
    });

    proc.on("error", (err) => reject(new Error(`ffmpeg process error: ${err.message}`)));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg exited with code ${code}`));
      } else {
        resolve(Buffer.concat(chunks));
      }
    });

    proc.stdin.write(input);
    proc.stdin.end();
  });
}
