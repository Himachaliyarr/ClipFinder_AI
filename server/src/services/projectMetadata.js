function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

export function normalizeTags(value) {
  if (!Array.isArray(value)) throw badRequest('Tags must be a list');
  if (value.length > 20 || value.some(tag => typeof tag !== 'string' || tag.trim().length > 40)) {
    throw badRequest('Use up to 20 tags, each no longer than 40 characters');
  }
  const tags = new Map();
  for (const tag of value.map(value => value.trim()).filter(Boolean)) {
    const key = tag.toLowerCase();
    if (!tags.has(key)) tags.set(key, tag);
  }
  return [...tags.values()];
}

export function normalizeFolder(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.trim().length > 100) {
    throw badRequest('Folder names must be no longer than 100 characters');
  }
  return value.trim();
}
