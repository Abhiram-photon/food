import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import type { AppConfig } from './config';
import { Db } from './db';
import { AppError, forbidden, notFound } from './lib/errors';
import { createEmailSender, type EmailSender } from './emails/sender';
import { resolveSession, type SessionUser } from './services/auth';
import { sweepStatuses } from './services/listings';
import { registerAuthRoutes } from './routes/auth';
import { registerListingRoutes } from './routes/listings';
import { registerReservationRoutes } from './routes/reservations';
import { registerNotificationRoutes } from './routes/notifications';
import { registerAdminRoutes } from './routes/admin';
import { registerImpactRoutes } from './routes/impact';
import { registerMetaRoutes } from './routes/meta';

export interface BuildAppOptions {
  db: Db;
  config: AppConfig;
  emailSender?: EmailSender;
  /** Adds request logging; disabled in tests. */
  logger?: boolean;
  /** Optional periodic status sweep (index.ts enables it). */
  sweepIntervalMs?: number;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface AppBundle {
  app: FastifyInstance;
  db: Db;
  config: AppConfig;
  emailSender: EmailSender;
  /** Stops timers created by buildApp. */
  close: () => Promise<void>;
}

export async function buildApp(options: BuildAppOptions): Promise<AppBundle> {
  const { db, config } = options;
  const emailSender = options.emailSender ?? createEmailSender(config);

  const app = Fastify({
    logger:
      options.logger === false || config.logLevel === 'silent'
        ? false
        : { level: config.logLevel, transport: undefined },
    bodyLimit: 1_048_576,
    trustProxy: true,
  });

  await app.register(cookie, { secret: config.appSecret });

  // ---- session resolution -------------------------------------------------
  app.decorateRequest('sessionUser', null);
  app.addHook('onRequest', async (request, reply) => {
    const token = request.cookies[config.sessionCookieName];
    request.sessionUser = resolveSession({ db, config }, token);
    if (token && !request.sessionUser) {
      reply.clearCookie(config.sessionCookieName, { path: '/' });
    }
  });

  // ---- CSRF: every mutating request must carry X-Requested-With -------------
  app.addHook('preHandler', async (request) => {
    if (!MUTATING_METHODS.has(request.method)) return;
    if (request.url.startsWith('/api/')) {
      const header = request.headers['x-requested-with'];
      if (typeof header !== 'string' || header.trim().length === 0) {
        throw new AppError(403, 'CSRF_HEADER_MISSING', 'Missing X-Requested-With header.');
      }
      // Defence in depth: if the client supplies the session CSRF token it must match.
      const token = request.headers['x-csrf-token'];
      if (
        request.sessionUser &&
        typeof token === 'string' &&
        token !== request.sessionUser.session.csrf_token
      ) {
        throw new AppError(403, 'CSRF_TOKEN_MISMATCH', 'Invalid CSRF token.');
      }
    }
  });

  // ---- clock-driven status sweep ------------------------------------------
  let lastSweep = 0;
  app.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api/')) return;
    const now = Date.now();
    // At most once per second per process; the 60s timer in index.ts covers idle periods.
    if (now - lastSweep < 1000) return;
    lastSweep = now;
    try {
      sweepStatuses(db, new Date(now));
    } catch (error) {
      request.log.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'status sweep failed',
      );
    }
  });

  // ---- errors --------------------------------------------------------------
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/')) {
      const error = notFound(`No route matches ${request.method} ${request.url}.`);
      reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
      return;
    }
    reply.code(404).type('text/plain').send('Not found');
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
      return;
    }
    const generic = error as { statusCode?: number; message?: string };
    const statusCode = generic.statusCode ?? 500;
    if (statusCode >= 500) {
      request.log.error({ err: generic.message ?? 'unknown error' }, 'unhandled error');
    }
    reply.code(statusCode).send({
      error: {
        code: statusCode === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
        message:
          statusCode === 500
            ? 'Something went wrong on our side.'
            : (generic.message ?? 'Request failed.'),
      },
    });
  });

  app.get('/api', async () => ({
    name: 'FreshRelay API',
    version: '1.0.0',
    endpoints: [
      'GET  /api/health',
      'GET  /api/config',
      'POST /api/auth/register',
      'POST /api/auth/login',
      'POST /api/auth/logout',
      'GET  /api/auth/me',
      'GET  /api/listings',
      'GET  /api/listings/:id',
      'POST /api/listings',
      'PATCH /api/listings/:id',
      'POST /api/listings/:id/status',
      'POST /api/listings/:id/reservations',
      'GET  /api/reservations',
      'POST /api/reservations/:id/cancel',
      'POST /api/reservations/verify',
      'GET  /api/impact',
      'GET  /api/notifications',
      'POST /api/notifications/read',
      'GET  /api/admin/organizations',
      'POST /api/admin/organizations/:id/review',
      'GET  /api/admin/totals',
    ],
  }));

  registerMetaRoutes(app, { db, config, emailSender });
  registerAuthRoutes(app, { db, config, emailSender });
  registerListingRoutes(app, { db, config, emailSender });
  registerReservationRoutes(app, { db, config, emailSender });
  registerNotificationRoutes(app, { db, config, emailSender });
  registerImpactRoutes(app, { db, config, emailSender });
  registerAdminRoutes(app, { db, config, emailSender });

  let timer: NodeJS.Timeout | null = null;
  const interval = options.sweepIntervalMs ?? 0;
  if (interval > 0) {
    timer = setInterval(() => {
      try {
        sweepStatuses(db, new Date());
      } catch {
        /* sweep failures must never crash the server */
      }
    }, interval);
    timer.unref?.();
  }

  return {
    app,
    db,
    config,
    emailSender,
    close: async () => {
      if (timer) clearInterval(timer);
      await app.close();
    },
  };
}

export { forbidden };
export type { SessionUser };
