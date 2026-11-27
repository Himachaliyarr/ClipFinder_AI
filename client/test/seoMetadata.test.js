import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const clientRoot = new URL("../", import.meta.url);

test("public landing page exposes indexable metadata and structured data", async () => {
  const html = await readFile(new URL("index.html", clientRoot), "utf8");
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>AI Podcast Clip Generator \| ClipFinder AI<\/title>/);
  assert.match(html, /name="description"/);
  assert.match(html, /property="og:title"/);
  assert.match(html, /name="twitter:card"/);

  const structuredData = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(structuredData);
  assert.equal(JSON.parse(structuredData[1]).name, "ClipFinder AI");
});

test("authenticated workspace is explicitly excluded from search indexing", async () => {
  const html = await readFile(new URL("app.html", clientRoot), "utf8");
  assert.match(html, /name="robots" content="noindex,nofollow"/);
});

test("robots policy leaves public pages crawlable and excludes API paths", async () => {
  const robots = await readFile(new URL("public/robots.txt", clientRoot), "utf8");
  assert.match(robots, /Allow: \//);
  assert.match(robots, /Disallow: \/api\//);
});
