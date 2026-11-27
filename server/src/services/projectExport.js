import path from "node:path";

export function createPortableSourceReference(value) {
  const name = path.posix.basename(String(value || "source").replace(/\\/g, "/"));
  return {
    name,
    url: `file://localhost/source/${encodeURIComponent(name)}`,
  };
}
