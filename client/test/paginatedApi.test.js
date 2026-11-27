import test from "node:test";
import assert from "node:assert/strict";
import api from "../src/services/apiClient.js";
import { fetchAllPages } from "../src/services/paginatedApi.js";

test("fetches each cursor page and returns the combined items", async (t) => {
  const originalGet = api.get;
  const requests = [];
  api.get = async (path, { params }) => {
    requests.push({ path, params });
    return requests.length === 1
      ? { data: { items: [{ id: 1 }], nextCursor: "next-page" } }
      : { data: { items: [{ id: 2 }], nextCursor: null } };
  };
  t.after(() => {
    api.get = originalGet;
  });

  assert.deepEqual(await fetchAllPages("/podcasts"), [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(requests.map(({ params }) => params), [
    { limit: 100 },
    { limit: 100, cursor: "next-page" },
  ]);
});

test("rejects repeated cursors instead of looping forever", async (t) => {
  const originalGet = api.get;
  api.get = async () => ({
    data: { items: [], nextCursor: "same-page" },
  });
  t.after(() => {
    api.get = originalGet;
  });

  await assert.rejects(fetchAllPages("/podcasts"), /repeated cursor/);
});
