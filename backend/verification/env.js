process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'isolated-auth-test-secret-never-for-production';
process.env.OTP_MODE = 'mock';
delete process.env.MONGO_URI;
delete process.env.MONGODB_URI;
