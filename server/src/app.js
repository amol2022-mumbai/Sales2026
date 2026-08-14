import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import apiRoutes from './routes/index.js';
import billingWebhookRoutes from './routes/billingWebhook.routes.js';
import { auditMiddleware } from './services/auditService.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
    })
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Non-browser requests (no Origin header) are always allowed.
        if (!origin) return callback(null, true);
        // Tests bypass CORS restrictions.
        if (env.isTest) return callback(null, true);
        // Explicitly allowed origins (set CORS_ORIGINS in production).
        if (env.corsOrigins.includes(origin)) return callback(null, true);
        // In development, allow local browser origins for convenience.
        if (
          !env.isProduction &&
          (origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1'))
        ) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: true,
    })
  );

  // Payment-provider webhook must run before the JSON body parser so the raw
  // body is available for HMAC signature verification. `raw` applies only to
  // this route.
  app.use('/api', billingWebhookRoutes);

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  if (!env.isTest) {    app.use(morgan(env.isProduction ? 'combined' : 'dev'));
  }

  app.use(auditMiddleware());

  const skipInTest = () => env.isTest;

  // Auth endpoints rate-limited to mitigate brute force.
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    skip: skipInTest,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many login attempts, try again later' } },
  });
  app.use('/api/auth/login', authLimiter);

  // Password change is rate-limited to slow down credential attacks.
  const changePasswordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    skip: skipInTest,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many password change attempts, try again later' } },
  });
  app.use('/api/auth/change-password', changePasswordLimiter);

  // Super admin surface is rate-limited to reduce abuse/automation.
  const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    skip: skipInTest,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests, try again later' } },
  });
  app.use('/api/admin', adminLimiter);

  // Broad per-IP API rate limit as a coarse DoS mitigation.
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 2000,
    skip: skipInTest,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests, try again later' } },
  });
  app.use('/api', apiLimiter);

  app.use('/api', apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
