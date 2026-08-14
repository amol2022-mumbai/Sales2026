// Env configuration MUST be set before any src/ module is imported.
process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.JWT_SECRET = 'test-secret-key-for-unit-tests-only-0123456789abcdef';
process.env.JWT_EXPIRES_IN = '1h';
process.env.SEED_ADMIN_EMAIL = 'admin@test.com';
process.env.SEED_ADMIN_PASSWORD = 'AdminPass123!';
process.env.SEED_COMPANY_NAME = 'Test Company';
process.env.CORS_ORIGINS = 'http://localhost:5173';
