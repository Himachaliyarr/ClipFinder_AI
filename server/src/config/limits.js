import './env.js';

function positiveInteger(name, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${name} must be a positive integer no greater than ${maximum}`);
  }
  return value;
}

export const MAX_UPLOAD_BYTES = positiveInteger('MAX_UPLOAD_BYTES', 5 * 1024 ** 3);
export const MAX_UPLOAD_FILES = positiveInteger('MAX_UPLOAD_FILES', 12, 50);
