import api from "./apiClient.js";

export async function fetchAllPages(path) {
  const items = [];
  const cursors = new Set();
  let cursor;

  while (true) {
    const params = { limit: 100 };
    if (cursor) params.cursor = cursor;
    const { data } = await api.get(path, { params });
    if (Array.isArray(data)) return data;
    if (!data || !Array.isArray(data.items)) {
      throw new Error("The paginated API response is invalid");
    }

    items.push(...data.items);
    if (!data.nextCursor) return items;
    if (cursors.has(data.nextCursor)) {
      throw new Error("The paginated API returned a repeated cursor");
    }
    cursors.add(data.nextCursor);
    cursor = data.nextCursor;
  }
}
