// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const isMulterError = err.name === "MulterError";
  const status = err.status || err.statusCode || (isMulterError ? 400 : 500);
  const uploadMessage =
    err.code === "LIMIT_FILE_SIZE"
      ? "Image must be 650 KB or smaller."
      : err.message;
  const message =
    process.env.NODE_ENV === "production" && status === 500
      ? "Something went wrong. Please try again."
      : uploadMessage || "Internal server error";

  if (status === 500) console.error(err);

  res.status(status).json({ error: message });
}

module.exports = { errorHandler };
