import { definePluginEntry } from "openclaw/plugin-sdk/core";
import { buildChatterboxSpeechProvider } from "./src/chatterbox-provider.js";

export default definePluginEntry({
  id: "chatterbox",
  name: "Chatterbox TTS",
  description: "Local text-to-speech via Chatterbox with zero-shot voice cloning",
  register(api) {
    api.registerSpeechProvider(buildChatterboxSpeechProvider());
  },
});
