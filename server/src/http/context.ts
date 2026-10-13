import type { AppConfig } from '../config';
import { Db } from '../db';
import type { EmailSender } from '../emails/sender';
import { forbidden, unauthenticated } from '../lib/errors';
import type { SessionUser } from '../services/auth';
import type { Role } from '../schemas/common';

export interface AppContext {
  db: Db;
  config: AppConfig;
  emailSender: EmailSender;
}

export function requireUser(request: { sessionUser: SessionUser | null }): SessionUser {
  if (!request.sessionUser) throw unauthenticated();
  return request.sessionUser;
}

export function requireRoleOnRequest(
  request: { sessionUser: SessionUser | null },
  ...roles: Role[]
): SessionUser {
  const user = requireUser(request);
  if (!roles.includes(user.user.role as Role)) {
    throw forbidden(`This action requires one of these roles: ${roles.join(', ')}.`, 'WRONG_ROLE');
  }
  return user;
}
