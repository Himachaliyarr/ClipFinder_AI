import test from "node:test";
import assert from "node:assert/strict";
import { asyncHandler } from "../src/middleware/asyncHandler.js";
import { errorHandler } from "../src/middleware/errorHandler.js";

test("asyncHandler forwards rejected route handlers", async () => {
  const expectedError = new Error("route failed");
  let actualError;
  const handler = asyncHandler(async () => {
    throw expectedError;
  });

  await handler({}, {}, (error) => {
    actualError = error;
  });

  assert.equal(actualError, expectedError);
});

test("asyncHandler forwards synchronous route errors", async () => {
  const expectedError = new Error("sync route failed");
  let actualError;
  const handler = asyncHandler(() => {
    throw expectedError;
  });

  await handler({}, {}, (error) => {
    actualError = error;
  });

  assert.equal(actualError, expectedError);
});

test("errorHandler returns request IDs and hides internal error details", () => {
  const originalConsoleError = console.error;
  let responseStatus;
  let responseBody;
  console.error = () => {};
  try {
    errorHandler(
      new Error("database credentials leaked"),
      { headersSent: false, requestId: "request-123", method: "GET", path: "/api" },
      {
        status(status) {
          responseStatus = status;
          return this;
        },
        json(body) {
          responseBody = body;
        },
      },
      assert.fail,
    );
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(responseStatus, 500);
  assert.deepEqual(responseBody, {
    error: "Internal server error",
    requestId: "request-123",
  });
});
