import { Db } from '../db';
import type { NotificationRow } from '../db/types';
import { newId } from '../lib/crypto';
import { nowIso } from '../lib/time';
import type { NotificationType } from '../schemas/common';
import type { NotificationListResponse, NotificationView } from '../schemas/notifications';

export interface NotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string | null;
  entityId?: string | null;
}

export function createNotification(db: Db, input: NotificationInput): NotificationRow {
  const id = newId();
  const now = nowIso();
  db.run(
    `INSERT INTO notifications (id, user_id, type, title, body, link, entity_id, read_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    [id, input.userId, input.type, input.title, input.body ?? '', input.link ?? null, input.entityId ?? null, now],
  );
  return db.get<NotificationRow>('SELECT * FROM notifications WHERE id = ?', [id])!;
}

/** Fan-out to every active user of an organization. */
export function notifyOrganization(
  db: Db,
  organizationId: string,
  input: Omit<NotificationInput, 'userId'>,
): number {
  const users = db.all<{ id: string }>(
    'SELECT id FROM users WHERE organization_id = ? AND is_active = 1',
    [organizationId],
  );
  for (const user of users) createNotification(db, { ...input, userId: user.id });
  return users.length;
}

export function notifyUser(db: Db, input: NotificationInput): void {
  createNotification(db, input);
}

function toView(row: NotificationRow): NotificationView {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    link: row.link,
    entityId: row.entity_id,
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

export function listNotifications(
  db: Db,
  userId: string,
  options: { unreadOnly?: boolean; limit?: number } = {},
): NotificationListResponse {
  const limit = Math.min(100, Math.max(1, options.limit ?? 30));
  const rows = db.all<NotificationRow>(
    `SELECT * FROM notifications
      WHERE user_id = ? ${options.unreadOnly ? 'AND read_at IS NULL' : ''}
      ORDER BY created_at DESC
      LIMIT ?`,
    [userId, limit],
  );
  const unread = db.get<{ count: number }>(
    'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL',
    [userId],
  );
  return {
    notifications: rows.map(toView),
    unreadCount: Number(unread?.count ?? 0),
  };
}

export function unreadCount(db: Db, userId: string): number {
  const row = db.get<{ count: number }>(
    'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL',
    [userId],
  );
  return Number(row?.count ?? 0);
}

export function markNotificationsRead(
  db: Db,
  userId: string,
  options: { ids?: string[]; all?: boolean },
): number {
  const now = nowIso();
  if (options.all || !options.ids || options.ids.length === 0) {
    const result = db.run(
      'UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL',
      [now, userId],
    );
    return Number(result.changes ?? 0);
  }
  let changes = 0;
  for (const id of options.ids) {
    const result = db.run(
      'UPDATE notifications SET read_at = ? WHERE user_id = ? AND id = ? AND read_at IS NULL',
      [now, userId, id],
    );
    changes += Number(result.changes ?? 0);
  }
  return changes;
}
