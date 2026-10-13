import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadConfig } from './config';
import { createDb } from './db';
import { buildApp } from './app';

async function main(): Promise<void> {
  const config = loadConfig();
  const databasePath =
    config.databasePath === ':memory:' ? ':memory:' : resolve(process.cwd(), config.databasePath);

  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const db = createDb(databasePath);
  const { app } = await buildApp({
    db,
    config,
    logger: true,
    sweepIntervalMs: config.sweepIntervalMs,
  });

  if (config.usingDefaultSecret) {
    app.log.warn(
      'APP_SECRET is using the built-in development default. Set APP_SECRET before any real deployment.',
    );
  }
  if (config.nodeEnv === 'production' && config.usingDefaultSecret) {
    throw new Error('Refusing to start in production with the default APP_SECRET.');
  }

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`FreshRelay API listening on http://${config.host}:${config.port}`);

  const shutdown = async (signal: string) => {
    app.log.info(`${signal} received, shutting down`);
    try {
      await app.close();
      db.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[fatal] server failed to start', error);
  process.exit(1);
});
