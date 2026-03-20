import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ensureServer } from "./src/server-manager.js";
import { resolveChatterboxConfig } from "./src/chatterbox-provider.js";

type SynthesizeResponse = {
  audio: string;
  sample_rate: number;
  format: string;
};

const chatterboxPlugin = {
  id: "chatterbox",
  name: "Chatterbox TTS",
  description: "Local text-to-speech via Chatterbox server",
  register(api: any) {
    api.registerTool({
      name: "chatterbox_tts",
      label: "Chatterbox TTS",
      description: "Generate speech audio from text using the Chatterbox server and return a MEDIA file path.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text to synthesize" },
        },
        required: ["text"],
      },
      execute: async (_toolCallId: string, params: { text: string }) => {
        const text = params?.text?.trim();
        if (!text) throw new Error("text parameter is required");

        const cfg = resolveChatterboxConfig(api?.config);
        const baseUrl = await ensureServer(cfg);

        const res = await fetch(`${baseUrl}/synthesize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`Chatterbox synth failed (${res.status}): ${body}`);
        }

        const data = (await res.json()) as SynthesizeResponse;
        const wav = Buffer.from(data.audio, "base64");

        const outDir = join(tmpdir(), "openclaw-chatterbox");
        await mkdir(outDir, { recursive: true });
        const outPath = join(outDir, `chatterbox-${Date.now()}.wav`);
        await writeFile(outPath, wav);

        return {
          content: [
            {
              type: "text" as const,
              text: `Generated Chatterbox audio.\nMEDIA: ${outPath}`,
            },
          ],
        };
      },
    });

    api.registerCommand({
      name: "chatterbox-health",
      description: "Check Chatterbox server health",
      acceptsArgs: false,
      requireAuth: true,
      handler: async () => {
        const cfg = resolveChatterboxConfig(api?.config);
        const baseUrl = await ensureServer(cfg);
        const res = await fetch(`${baseUrl}/health`);
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          return `Chatterbox health failed (${res.status}): ${body}`;
        }
        const body = await res.text();
        return `Chatterbox healthy at ${baseUrl}\n${body}`;
      },
    });
  },
};

export default chatterboxPlugin;
