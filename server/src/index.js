import { env, validateEnv } from './config/env.js';
import { migrate } from './db/migrate.js';
import { seedDatabase } from './db/seed.js';
import { createApp } from './app.js';
import { runFollowUpReminders } from './services/followUpService.js';

function boot() {
  const problems = validateEnv();
  if (problems.length) {
    console.warn('[env] configuration warnings:');
    for (const p of problems) console.warn(`  - ${p}`);
    if (env.isProduction) {
      console.error('Refusing to start in production with invalid configuration.');
      process.exit(1);
    }
  }

  migrate();
  const seed = seedDatabase();
  runFollowUpReminders();
  setInterval(runFollowUpReminders, 60 * 60 * 1000).unref();

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`[server] listening on http://localhost:${env.port} (${env.nodeEnv})`);
    console.log(`[server] super admin ready: ${seed.adminEmail}`);
  });

  const shutdown = (signal) => {
    console.log(`[server] ${signal} received, shutting down`);
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

boot();
