export function getExpectedChunkLength(size, offset, chunkBytes) {
  if (!Number.isSafeInteger(size) || size <= 0
    || !Number.isSafeInteger(offset) || offset < 0 || offset >= size
    || !Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) {
    throw new Error('Upload size, offset, or chunk size is invalid');
  }
  return Math.min(chunkBytes, size - offset);
}
