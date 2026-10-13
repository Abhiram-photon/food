import { z } from 'zod';

export const notificationQuerySchema = z.object({
  unread_only: z
    .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
    .optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const markNotificationsReadSchema = z.object({
  ids: z.array(z.string().min(1)).max(200).optional(),
  all: z.boolean().optional(),
});

export interface NotificationView {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationListResponse {
  notifications: NotificationView[];
  unreadCount: number;
}
