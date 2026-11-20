import "./env.js";

function positiveInteger(name, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(
      `${name} must be a positive integer no greater than ${maximum}`,
    );
  }
  return value;
}

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
