import type { AppConfig } from '../config';
import { Db } from '../db';
import type { OrganizationRow, SessionRow, UserRow } from '../db/types';
import { digest, hashPassword, newId, randomToken, verifyPassword } from '../lib/crypto';
import { conflict, forbidden, notFound, unauthenticated } from '../lib/errors';
import { isoHoursFrom, nowIso } from '../lib/time';
import type { AuthResponse, PublicUser, RegisterInput } from '../schemas/auth';
import type { Role } from '../schemas/common';

export interface AuthContext {
  db: Db;
  config: AppConfig;
}

export interface SessionUser {
  user: UserRow;
  organization: OrganizationRow | null;
  session: SessionRow;
}

export interface Capabilities {
  canPublishListing: boolean;
  canReserve: boolean;
  canVerifyPickup: boolean;
  canModerateOrganizations: boolean;
  blockedReason: string | null;
}

export function capabilitiesFor(user: UserRow, organization: OrganizationRow | null): Capabilities {
  const role = user.role as Role;
  const orgApproved = organization?.status === 'APPROVED';
  const isAdmin = role === 'ADMIN';

  let blockedReason: string | null = null;
  if (!isAdmin && organization && organization.status === 'PENDING') {
    blockedReason =
      'Your organization is still pending review. You can browse and prepare, but publishing and reserving unlock after an admin approves you.';
  } else if (!isAdmin && organization && organization.status === 'REJECTED') {
    blockedReason = 'Your organization application was rejected. Contact the FreshRelay admin team.';
  } else if (!isAdmin && !organization) {
    blockedReason = 'Your account is not linked to an organization. Contact the FreshRelay admin team.';
  }

  return {
    canPublishListing: role === 'PROVIDER' && orgApproved,
    canReserve: role === 'RECIPIENT' && orgApproved,
    canVerifyPickup: role === 'PROVIDER' && orgApproved,
    canModerateOrganizations: isAdmin,
    blockedReason,
  };
}

export function toPublicUser(user: UserRow, organization: OrganizationRow | null): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    role: user.role as Role,
    organizationId: user.organization_id,
    organizationName: organization?.name ?? null,
    organizationStatus: organization?.status ?? null,
    organizationType: organization?.type ?? null,
    createdAt: user.created_at,
  };
}

export async function register(
  ctx: AuthContext,
  input: RegisterInput,
): Promise<{ user: UserRow; organization: OrganizationRow }> {
  const { db } = ctx;
  const existing = db.get<UserRow>('SELECT * FROM users WHERE email = ?', [input.email]);
  if (existing) throw conflict('An account with that email already exists.', 'EMAIL_TAKEN');

  const now = nowIso();
  const organizationId = newId();
  const userId = newId();
  const passwordHash = await hashPassword(input.password);

  return db.transaction(() => {
    db.run(
      `INSERT INTO organizations
        (id, name, type, role, status, contact_email, phone, address, latitude, longitude, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?)`,
      [
        organizationId,
        input.organizationName,
        input.organizationType,
        input.role,
        input.email,
        input.phone || null,
        input.address || null,
        input.latitude ?? null,
        input.longitude ?? null,
        now,
        now,
      ],
    );
    db.run(
      `INSERT INTO users (id, organization_id, email, password_hash, display_name, role, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [userId, organizationId, input.email, passwordHash, input.displayName, input.role, now, now],
    );
    const organization = db.get<OrganizationRow>('SELECT * FROM organizations WHERE id = ?', [
      organizationId,
    ])!;
    const user = db.get<UserRow>('SELECT * FROM users WHERE id = ?', [userId])!;
    return { user, organization };
  });
}

export async function login(ctx: AuthContext, email: string, password: string): Promise<UserRow> {
  const { db } = ctx;
  const user = db.get<UserRow>('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
  // Always run a scrypt verification so timing does not reveal whether the email exists.
  const hash = user?.password_hash ?? 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA';
  const ok = await verifyPassword(password, hash);
  if (!user || !ok || !user.is_active) {
    throw unauthenticated('Email or password is incorrect.');
  }
  return user;
}

export function createSession(ctx: AuthContext, userId: string): { token: string; session: SessionRow } {
  const { db, config } = ctx;
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const now = new Date();
  const session: SessionRow = {
    id: newId(),
    user_id: userId,
    token_hash: digest(token),
    csrf_token: csrfToken,
    expires_at: isoHoursFrom(now, config.sessionTtlHours),
    created_at: now.toISOString(),
  };
  db.run(
    `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [session.id, session.user_id, session.token_hash, session.csrf_token, session.expires_at, session.created_at],
  );
  // Opportunistic cleanup of long-expired sessions keeps the table small in this single-process MVP.
  db.run('DELETE FROM sessions WHERE expires_at < ?', [now.toISOString()]);
  return { token, session };
}

export function resolveSession(ctx: AuthContext, token: string | undefined): SessionUser | null {
  if (!token) return null;
  const { db } = ctx;
  const session = db.get<SessionRow>('SELECT * FROM sessions WHERE token_hash = ?', [digest(token)]);
  if (!session) return null;
  if (Date.parse(session.expires_at) <= Date.now()) {
    db.run('DELETE FROM sessions WHERE id = ?', [session.id]);
    return null;
  }
  const user = db.get<UserRow>('SELECT * FROM users WHERE id = ?', [session.user_id]);
  if (!user || !user.is_active) return null;
  const organization = user.organization_id
    ? (db.get<OrganizationRow>('SELECT * FROM organizations WHERE id = ?', [user.organization_id]) ??
      null)
    : null;
  return { user, organization, session };
}

export function destroySession(ctx: AuthContext, sessionId: string): void {
  ctx.db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
}

export function buildAuthResponse(sessionUser: SessionUser): AuthResponse {
  return {
    user: toPublicUser(sessionUser.user, sessionUser.organization),
    csrfToken: sessionUser.session.csrf_token,
    capabilities: capabilitiesFor(sessionUser.user, sessionUser.organization),
  };
}

export function requireSession(sessionUser: SessionUser | null): SessionUser {
  if (!sessionUser) throw unauthenticated();
  return sessionUser;
}

export function requireRole(sessionUser: SessionUser | null, role: Role): SessionUser {
  const user = requireSession(sessionUser);
  if (user.user.role !== role) {
    throw forbidden(`This action requires the ${role} role.`, 'WRONG_ROLE');
  }
  return user;
}

export function requireApprovedOrganization(sessionUser: SessionUser): OrganizationRow {
  const organization = sessionUser.organization;
  if (!organization) throw forbidden('Your account is not linked to an organization.');
  if (organization.status === 'REJECTED') {
    throw forbidden('Your organization application was rejected.', 'ORG_REJECTED');
  }
  if (organization.status === 'PENDING') {
    throw forbidden(
      'Your organization is pending admin approval, so this action is not available yet.',
      'ORG_PENDING',
    );
  }
  return organization;
}

export function getUserById(db: Db, id: string): UserRow {
  const user = db.get<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) throw notFound('User not found.');
  return user;
}

export function getOrganizationById(db: Db, id: string): OrganizationRow {
  const organization = db.get<OrganizationRow>('SELECT * FROM organizations WHERE id = ?', [id]);
  if (!organization) throw notFound('Organization not found.');
  return organization;
}

export function listUsersForOrganization(db: Db, organizationId: string): UserRow[] {
  return db.all<UserRow>('SELECT * FROM users WHERE organization_id = ? AND is_active = 1', [
    organizationId,
  ]);
}

export async function changePassword(
  ctx: AuthContext,
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = getUserById(ctx.db, userId);
  const ok = await verifyPassword(currentPassword, user.password_hash);
  if (!ok) throw unauthenticated('Current password is incorrect.');
  const hash = await hashPassword(newPassword);
  ctx.db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [
    hash,
    nowIso(),
    userId,
  ]);
}

export function updateOrganizationProfile(
  db: Db,
  organizationId: string,
  patch: {
    organizationName?: string;
    phone?: string;
    address?: string;
    latitude?: number;
    longitude?: number;
  },
): OrganizationRow {
  const org = getOrganizationById(db, organizationId);
  db.run(
    `UPDATE organizations SET name = ?, phone = ?, address = ?, latitude = ?, longitude = ?, updated_at = ?
     WHERE id = ?`,
    [
      patch.organizationName ?? org.name,
      patch.phone !== undefined ? patch.phone || null : org.phone,
      patch.address !== undefined ? patch.address || null : org.address,
      patch.latitude ?? org.latitude,
      patch.longitude ?? org.longitude,
      nowIso(),
      organizationId,
    ],
  );
  return getOrganizationById(db, organizationId);
}
