export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status =
    err.status ||
    (err.code === "ENOSPC"
      ? 507
      : err.code === "LIMIT_FILE_SIZE"
        ? 413
        : err.name === "MulterError"
          ? 400
          : 500);
  console.error(
    JSON.stringify({
      level: "error",
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      status,
      errorName: err.name || "Error",
      message: String(err.message || "Unknown error").slice(0, 1000),
    }),
  );
  const message =
    err.code === "ENOSPC"
      ? "Storage is full. Free disk space or configure MEDIA_ROOT with more capacity, then retry."
      : err.code === "LIMIT_FILE_SIZE"
        ? "A file exceeds the configured upload-size limit"
        : err.code === "LIMIT_FILE_COUNT"
          ? "This upload exceeds the configured file-count limit"
          : status >= 500
            ? "Internal server error"
            : err.message;
  res.status(status).json({ error: message, requestId: req.requestId });
}
