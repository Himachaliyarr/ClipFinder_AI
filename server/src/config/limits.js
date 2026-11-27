import { positiveInteger } from "./settings.js";

export const MAX_UPLOAD_BYTES = positiveInteger(
  "MAX_UPLOAD_BYTES",
  20 * 1024 ** 3,
);
export const MAX_UPLOAD_FILES = positiveInteger("MAX_UPLOAD_FILES", 12, 50);
export const MAX_RESUMABLE_UPLOAD_BYTES = positiveInteger(
  "MAX_RESUMABLE_UPLOAD_BYTES",
  100 * 1024 ** 3,
);
export const UPLOAD_CHUNK_BYTES = positiveInteger(
  "UPLOAD_CHUNK_BYTES",
  16 * 1024 ** 2,
  MAX_RESUMABLE_UPLOAD_BYTES,
);
