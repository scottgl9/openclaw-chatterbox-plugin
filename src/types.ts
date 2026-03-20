/** Chatterbox model variants. */
export type ChatterboxModel = "turbo" | "standard" | "multilingual";

/** Device selection for PyTorch. */
export type ChatterboxDevice = "auto" | "cuda" | "mps" | "cpu";

/** Plugin-level configuration resolved from cfg + env vars + defaults. */
export interface ChatterboxConfig {
  baseUrl: string;
  model: ChatterboxModel;
  device: ChatterboxDevice;
  port: number;
  referenceAudio?: string;
  temperature?: number;
  exaggeration?: number;
  cfgWeight?: number;
}

/** Body sent to POST /synthesize. */
export interface ChatterboxSynthesizeRequest {
  text: string;
  reference_audio?: string;
  temperature?: number;
  exaggeration?: number;
  cfg_weight?: number;
}

/** Response from POST /synthesize. */
export interface ChatterboxSynthesizeResponse {
  audio: string; // base64-encoded WAV
  sample_rate: number;
  format: string;
}

/** Response from GET /health. */
export interface ChatterboxHealthResponse {
  status: string;
  model: string;
  device: string;
}
