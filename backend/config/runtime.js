const MOCKABLE_INTEGRATIONS = [
  "OTP_MODE",
  "SHIPROCKET_MODE",
  "FCM_MODE",
  "MAPS_MODE",
];

const INTEGRATION_MODES = {
  OTP_MODE: ["live", "mock"],
  RAZORPAY_MODE: ["live", "test"],
  SHIPROCKET_MODE: ["live", "mock"],
  FCM_MODE: ["live", "mock"],
  MAPS_MODE: ["live", "mock"],
};

const PAYMENT_GATEWAYS = ["razorpay"];

const LIVE_BULKIMART_HOSTS = new Set([
  "bulkimart.in",
  "www.bulkimart.in",
  "api.bulkimart.in",
]);

const parseHttpsUrl = (value, label) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS`);
  }
  return url;
};

const assertAuthorizedProductionStaging = (env) => {
  if (env.DEPLOYMENT_ENV !== "staging") {
    throw new Error("DEPLOYMENT_ENV must be staging to authorize production-runtime mocks");
  }
  if (env.ALLOW_MOCK_SERVICES !== "true") {
    throw new Error("ALLOW_MOCK_SERVICES must be explicitly set to true");
  }
  if (env.STAGING_DATA_ISOLATED !== "true") {
    throw new Error("STAGING_DATA_ISOLATED must confirm that staging uses isolated data");
  }

  const publicApiUrl = parseHttpsUrl(env.PUBLIC_API_URL || "", "PUBLIC_API_URL");
  if (LIVE_BULKIMART_HOSTS.has(publicApiUrl.hostname.toLowerCase())) {
    throw new Error("Production-runtime mocks cannot use a live Bulkimart hostname");
  }

  const corsOrigins = (env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (!corsOrigins.length) {
    throw new Error("CORS_ORIGINS must explicitly name the staging frontend origin");
  }
  for (const origin of corsOrigins) {
    const url = parseHttpsUrl(origin, "Each CORS_ORIGINS entry");
    if (LIVE_BULKIMART_HOSTS.has(url.hostname.toLowerCase())) {
      throw new Error("Production-runtime mocks cannot allow a live Bulkimart origin");
    }
  }
};

export const getMockIntegrations = (env = process.env) => MOCKABLE_INTEGRATIONS
  .filter((key) => env[key] === "mock");

/**
 * Validate integration modes before any database or network initialization.
 *
 * `NODE_ENV=production` is retained on staging so framework behavior matches
 * production. Mocks there require several independent, explicit signals and
 * cannot be attached to any live Bulkimart hostname or frontend origin.
 */
export const validateRuntimeConfig = (env = process.env) => {
  const integrationKeys = Object.keys(INTEGRATION_MODES);
  const missingModes = integrationKeys.filter((key) => env[key] === undefined || env[key] === "");
  if (env.NODE_ENV === "production" && missingModes.length) {
    throw new Error(`Production requires explicit integration modes: ${missingModes.join(", ")}`);
  }

  const invalidModes = integrationKeys.filter(
    (key) => env[key] !== undefined && !INTEGRATION_MODES[key].includes(env[key]),
  );
  if (invalidModes.length) {
    throw new Error(`Integration modes contain unsupported values: ${invalidModes.join(", ")}`);
  }

  if (env.NODE_ENV === "production" && !PAYMENT_GATEWAYS.includes(env.PAYMENT_GATEWAY)) {
    throw new Error("PAYMENT_GATEWAY must be razorpay in production");
  }

  const mocks = getMockIntegrations(env);
  const nonLiveIntegrations = [
    ...mocks,
    ...(env.RAZORPAY_MODE === "test" ? ["RAZORPAY_MODE"] : []),
  ];
  if (env.NODE_ENV === "production" && nonLiveIntegrations.length) {
    try {
      assertAuthorizedProductionStaging(env);
    } catch (error) {
      throw new Error(
        `Refusing to boot — non-live integrations enabled in production: ${nonLiveIntegrations.join(", ")}. ${error.message}`,
      );
    }
  }

  if (env.PAYMENT_GATEWAY === "razorpay") {
    const required = ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"]
      .filter((key) => !env[key]);
    if (required.length) {
      throw new Error(`Razorpay configuration is incomplete: ${required.join(", ")}`);
    }
    const expectedPrefix = env.RAZORPAY_MODE === "test" ? "rzp_test_" : "rzp_live_";
    if (!env.RAZORPAY_KEY_ID.startsWith(expectedPrefix)) {
      throw new Error(`RAZORPAY_KEY_ID does not match RAZORPAY_MODE=${env.RAZORPAY_MODE}`);
    }
  }

  return { mockIntegrations: mocks, paymentGateway: env.PAYMENT_GATEWAY };
};

/**
 * Service-level enforcement prevents a mock path from being reached if a
 * future entry point forgets to run the startup validator.
 */
export const isMockIntegrationEnabled = (key, env = process.env) => {
  if (!MOCKABLE_INTEGRATIONS.includes(key)) {
    throw new Error(`Unknown mockable integration: ${key}`);
  }
  validateRuntimeConfig(env);
  return env[key] === "mock";
};

export const getPaymentGateway = (env = process.env) => {
  validateRuntimeConfig(env);
  return env.PAYMENT_GATEWAY || (env.NODE_ENV === "production" ? undefined : "razorpay");
};

