import test from "node:test";
import assert from "node:assert/strict";
import { isCurrentTokenVersion } from "../src/middleware/auth.js";

test("accepts legacy tokens until a password reset increments the user version", () => {
  assert.equal(isCurrentTokenVersion(undefined, 0), true);
  assert.equal(isCurrentTokenVersion(undefined, 1), false);
});

test("accepts only tokens matching the current account version", () => {
  assert.equal(isCurrentTokenVersion(2, 2), true);
  assert.equal(isCurrentTokenVersion(1, 2), false);
});
