import type { FastifyInstance } from 'fastify';
import { parseInput } from '../http/validate';
import { requireRoleOnRequest, requireUser, type AppContext } from '../http/context';
import {
  cancelReservation,
  createReservation,
  getReservationForViewer,
  listReservationsForRecipient,
  verifyPickupCode,
} from '../services/reservations';
import {
  cancelReservationSchema,
  createReservationSchema,
  verifyPickupSchema,
} from '../schemas/reservations';

export function registerReservationRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config, emailSender } = ctx;
  const serviceCtx = { db, config, emailSender };

  /** Recipient creates a reservation. Stock changes inside BEGIN IMMEDIATE. */
  app.post('/api/listings/:id/reservations', async (request, reply) => {
    const sessionUser = requireRoleOnRequest(request, 'RECIPIENT');
    const { id } = request.params as { id: string };
    const input = parseInput(createReservationSchema, request.body ?? {});
    const result = createReservation(serviceCtx, sessionUser, id, input);
    reply.code(201);
    return result;
  });

  /** Recipient: my reservations (codes are re-revealed to their owner). */
  app.get('/api/reservations', async (request) => {
    const sessionUser = requireUser(request);
    if (sessionUser.user.role === 'PROVIDER') {
      const { listReservationsForProvider } = await import('../services/reservations');
      const reservations = listReservationsForProvider(serviceCtx, sessionUser);
      return { reservations, count: reservations.length };
    }
    const reservations = listReservationsForRecipient(serviceCtx, sessionUser);
    return { reservations, count: reservations.length };
  });

  app.get('/api/reservations/:id', async (request) => {
    const sessionUser = requireUser(request);
    const { id } = request.params as { id: string };
    return { reservation: getReservationForViewer(serviceCtx, sessionUser, id) };
  });

  app.post('/api/reservations/:id/cancel', async (request) => {
    const sessionUser = requireUser(request);
    const { id } = request.params as { id: string };
    const input = parseInput(cancelReservationSchema, request.body ?? {});
    return { reservation: cancelReservation(serviceCtx, sessionUser, id, input.reason) };
  });

  /** Provider verifies a pickup code (optionally scoped to a reservation id). */
  app.post('/api/reservations/verify', async (request) => {
    const sessionUser = requireRoleOnRequest(request, 'PROVIDER');
    const input = parseInput(verifyPickupSchema, request.body ?? {});
    const result = verifyPickupCode(serviceCtx, sessionUser, input);
    return {
      reservation: result.reservation,
      attemptsRemaining: result.attemptsRemaining,
      ok: true,
    };
  });

  app.post('/api/reservations/:id/verify', async (request) => {
    const sessionUser = requireRoleOnRequest(request, 'PROVIDER');
    const { id } = request.params as { id: string };
    const input = parseInput(verifyPickupSchema, request.body ?? {});
    const result = verifyPickupCode(serviceCtx, sessionUser, { ...input, reservationId: id });
    return {
      reservation: result.reservation,
      attemptsRemaining: result.attemptsRemaining,
      ok: true,
    };
  });
}
