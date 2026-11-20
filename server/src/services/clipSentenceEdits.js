const MAX_SENTENCE_EDITS = 500;

export function normalizeSentenceEdits(input, clipStart, clipEnd) {
  if (!Array.isArray(input) || input.length > MAX_SENTENCE_EDITS) {
    throw new Error(`Sentence edits must be an array with no more than ${MAX_SENTENCE_EDITS} items`);
  }

  const sentenceIds = new Set();
  const edits = input.map(item => {
    const start = Number(item?.start);
    const end = Number(item?.end);
    const sentenceId = typeof item?.sentenceId === 'string' ? item.sentenceId.trim() : '';
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < clipStart || end > clipEnd || end <= start) {
      throw new Error('Sentence edit timings must be within the clip range');
    }
    if (sentenceId && (sentenceId.length > 160 || sentenceIds.has(sentenceId))) {
      throw new Error('Sentence edit identifiers must be unique and no longer than 160 characters');
    }
    if (sentenceId) sentenceIds.add(sentenceId);
    return { ...(sentenceId ? { sentenceId } : {}), start, end };
  });

  const chronological = [...edits].sort((a, b) => a.start - b.start);
  for (let index = 1; index < chronological.length; index += 1) {
    if (chronological[index].start < chronological[index - 1].end) {
      throw new Error('Sentence edit ranges cannot overlap');
    }
  }

  return edits;
}
