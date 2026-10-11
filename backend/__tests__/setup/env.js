// Jest-only configuration. Never import dotenv or load the developer's .env
// from test setup: the cart API integration suite connects only to its own
// mongodb-memory-server instance.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'bulkimart-test-only-jwt-secret-not-for-production';
process.env.OTP_MODE = 'mock';
process.env.USE_MOCK_OTP = 'true';
process.env.REDIS_DISABLED = 'true';
process.env.MONGOMS_VERSION = '7.0.14';
delete process.env.MONGO_URI;
delete process.env.MONGODB_URI;
