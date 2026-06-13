/**
 * Provider-agnostic image-generation contract.
 *
 * A provider takes a prompt + options and returns one or more images, either as
 * raw bytes (when the upstream API can hand back base64) or as a TEMPORARY url
 * the caller must download immediately. The image service normalises both into
 * files on disk.
 */

export type ImageTask = 'icon' | 'sprite' | 'concept' | 'prop';

export interface GenOptions {
  /** Which backend to use. Default: 'xai'. ('openai' reserved for a later phase.) */
  provider?: 'xai' | 'openai';
  /** Task preset that shapes the final prompt (see prompts.ts). */
  task?: ImageTask;
  /** Provider model id. Provider supplies its own default when omitted. */
  model?: string;
  /** Number of images to generate. Default: 1. */
  n?: number;
  /** e.g. '1:1', '16:9'. Forwarded to providers that support it. */
  aspectRatio?: string;
  /** '1k' (default, 1024 jpeg) or '2k' (2048 png, higher cost). */
  resolution?: '1k' | '2k';
  /** Path/url to a reference image (reserved; not all providers support it). */
  referenceImage?: string;
  /** Request a transparent background where supported (reserved). */
  transparent?: boolean;
  /** Directory to write outputs into (created if missing). */
  outDir: string;
  /** Base filename (without extension) for the written files. */
  basename: string;

  // --- IMG P3: sprite post-processing (sharp pipeline) ---
  /** Post-process stages to run on the raw gen, in order. Raw is always kept. */
  postprocess?: Array<'removeBg' | 'downscale' | 'pack'>;
  /** Chroma key color for removeBg, hex ('00b140'/'#00b140') or [r,g,b]. */
  keyColor?: string | [number, number, number];
  /** Chroma distance tolerance for removeBg. */
  tolerance?: number;
  /** Target pixel height for downscale (nearest-neighbor). */
  pixelHeight?: number;
  /** Optional palette quantize color count for downscale. */
  palette?: number;
}

export interface GenImage {
  /** Raw image bytes (present when the provider returned base64). */
  bytes?: Uint8Array;
  /** Temporary download url (present when the provider returned a url). MUST be downloaded immediately. */
  url?: string;
  mimeType: string;
}

export interface GenResult {
  images: GenImage[];
  costUsd: number;
  model: string;
  /** The raw provider response, for debugging / provenance. */
  raw: unknown;
}

export interface ImageProvider {
  id: string;
  generate(prompt: string, opts: GenOptions): Promise<GenResult>;
}
