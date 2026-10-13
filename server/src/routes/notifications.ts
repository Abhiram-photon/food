import type { FastifyInstance } from 'fastify';
import { requireUser, type AppContext } from '../http/context';
import { parseInput } from '../http/validate';
import { listNotifications, markNotificationsRead } from '../services/notifications';
import { markNotificationsReadSchema, notificationQuerySchema } from '../schemas/notifications';

export function registerNotificationRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db } = ctx;

  app.get('/api/notifications', async (request) => {
    const sessionUser = requireUser(request);
    const query = parseInput(notificationQuerySchema, request.query ?? {});
    const unreadOnly = query.unread_only === 'true' || query.unread_only === '1';
    return listNotifications(db, sessionUser.user.id, { unreadOnly, limit: query.limit });
  });

  app.post('/api/notifications/read', async (request) => {
    const sessionUser = requireUser(request);
    const body = parseInput(markNotificationsReadSchema, request.body ?? {});
    const updated = markNotificationsRead(db, sessionUser.user.id, {
      ids: body.ids,
      all: body.all ?? true,
    });
    return { updated, unreadCount: listNotifications(db, sessionUser.user.id, { limit: 1 }).unreadCount };
  });
}
