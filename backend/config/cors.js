const LOCAL_ORIGINS = [
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

const PRODUCTION_ORIGINS = [
  "https://bulkimart.in",
  "https://www.bulkimart.in",
];

/**
 * Return exact browser origins accepted by both Express and Socket.IO.
 *
 * CORS_ORIGINS may override the defaults with a comma-separated list. This is
 * useful for staging, while production remains safe if the variable is absent.
 */
export const getAllowedOrigins = (env = process.env) => {
  const configured = (env.CORS_ORIGINS || env.APP_BASE_URL || env.FRONTEND_URL || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configured.includes("*")) {
    throw new Error("CORS_ORIGINS must contain exact origins; wildcard is not allowed with credentials");
  }
  if (configured.length) return [...new Set(configured)];
  return env.NODE_ENV === "production" ? PRODUCTION_ORIGINS : LOCAL_ORIGINS;
};

export const getCorsOptions = (env = process.env) => ({
  origin: getAllowedOrigins(env),
  credentials: true,
  methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  optionsSuccessStatus: 204,
  exposedHeaders: ['X-Request-ID'],
});
