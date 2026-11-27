import test from "node:test";
import assert from "node:assert/strict";
import { createPortableSourceReference } from "../src/services/projectExport.js";

test("exports only a portable source filename instead of an absolute storage path", () => {
  assert.deepEqual(
    createPortableSourceReference("/srv/clipfinder/media/podcast/video file.mp4"),
    {
      name: "video file.mp4",
      url: "file://localhost/source/video%20file.mp4",
    },
  );
  assert.equal(
    createPortableSourceReference("C:\\private\\media\\video.mp4").name,
    "video.mp4",
  );
});
