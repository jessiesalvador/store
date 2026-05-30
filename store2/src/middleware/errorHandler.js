// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  const message =
    process.env.NODE_ENV === "production" && status === 500
      ? "Something went wrong. Please try again."
      : err.message || "Internal server error";

  if (status === 500) console.error(err);

  res.status(status).json({ error: message });
}

module.exports = { errorHandler };
