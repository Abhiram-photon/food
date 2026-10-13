import type { AppConfig } from '../config';
import { Db } from '../db';
import type { OrganizationRow, UserRow } from '../db/types';
import { forbidden, notFound } from '../lib/errors';
import { nowIso, recentMonthKeys } from '../lib/time';
import type { EmailSender } from '../emails/sender';
import type { SessionUser } from './auth';
import { notifyOrganization } from './notifications';
import { mealsEstimate } from './impact';
import type { AdminOrganizationView, PlatformTotals } from '../schemas/admin';

export interface AdminContext {
  db: Db;
  config: AppConfig;
  emailSender: EmailSender;
}

function requireAdmin(actor: SessionUser): void {
  if (actor.user.role !== 'ADMIN') {
    throw forbidden('Only FreshRelay admins can perform this action.', 'WRONG_ROLE');
  }
}

export function listOrganizations(
  ctx: AdminContext,
  actor: SessionUser,
  filter: { status?: string; role?: string } = {},
): AdminOrganizationView[] {
  requireAdmin(actor);
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.status) {
    conditions.push('o.status = ?');
    params.push(filter.status);
  }
  if (filter.role) {
    conditions.push('o.role = ?');
    params.push(filter.role);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = ctx.db.all<
    OrganizationRow & { user_count: number; listing_count: number; reservation_count: number }
  >(
    `SELECT o.*,
            (SELECT COUNT(*) FROM users u WHERE u.organization_id = o.id) AS user_count,
            (SELECT COUNT(*) FROM listings l WHERE l.provider_id = o.id) AS listing_count,
            (SELECT COUNT(*) FROM reservations r WHERE r.recipient_id = o.id) AS reservation_count
       FROM organizations o
       ${where}
      ORDER BY CASE o.status WHEN 'PENDING' THEN 0 WHEN 'APPROVED' THEN 1 ELSE 2 END, o.created_at ASC`,
    params,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    role: row.role,
    status: row.status,
    contactEmail: row.contact_email,
    phone: row.phone,
    address: row.address,
    latitude: row.latitude,
    longitude: row.longitude,
    reviewNote: row.review_note,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    userCount: Number(row.user_count ?? 0),
    listingCount: Number(row.listing_count ?? 0),
    reservationCount: Number(row.reservation_count ?? 0),
  }));
}

export function reviewOrganization(
  ctx: AdminContext,
  actor: SessionUser,
  organizationId: string,
  decision: 'APPROVE' | 'REJECT',
  note: string,
): AdminOrganizationView {
  requireAdmin(actor);
  const organization = ctx.db.get<OrganizationRow>('SELECT * FROM organizations WHERE id = ?', [
    organizationId,
  ]);
  if (!organization) throw notFound('Organization not found.');
  if (organization.role === 'ADMIN') throw forbidden('Admin organizations cannot be reviewed.');

  const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  const now = nowIso();
  ctx.db.transaction(() => {
    ctx.db.run(
      `UPDATE organizations SET status = ?, review_note = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ?
        WHERE id = ?`,
      [status, note || null, now, actor.user.id, now, organizationId],
    );
    notifyOrganization(ctx.db, organizationId, {
      type: decision === 'APPROVE' ? 'ORG_APPROVED' : 'ORG_REJECTED',
      title:
        decision === 'APPROVE'
          ? `Your organization was approved 🎉`
          : `Your organization application was rejected`,
      body:
        decision === 'APPROVE'
          ? `${organization.name} is now approved. ${
              organization.role === 'PROVIDER'
                ? 'You can publish listings and verify pickups.'
                : 'You can now search and reserve surplus food.'
            }`
          : note || 'No reason was provided. Contact the FreshRelay team for details.',
      link: organization.role === 'PROVIDER' ? '/provider' : '/recipient',
      entityId: organizationId,
    });
  });

  const users = ctx.db.all<UserRow>('SELECT * FROM users WHERE organization_id = ?', [
    organizationId,
  ]);
  for (const user of users) {
    void ctx.emailSender.send({
      to: user.email,
      subject: `FreshRelay: organization ${status.toLowerCase()}`,
      body: `Hello ${user.display_name}, ${organization.name} was ${status.toLowerCase()} by FreshRelay admins.${
        note ? `\n\nNote: ${note}` : ''
      }`,
      template: decision === 'APPROVE' ? 'org-approved' : 'org-rejected',
    });
  }

  return listOrganizations(ctx, actor).find((org) => org.id === organizationId)!;
}

export function platformTotals(ctx: AdminContext, actor: SessionUser): PlatformTotals {
  requireAdmin(actor);
  const { db, config } = ctx;

  const org = db.get<Record<string, number>>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) AS approved,
            SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected
       FROM organizations`,
  );
  const listings = db.get<Record<string, number>>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN status = 'RESERVED_OUT' THEN 1 ELSE 0 END) AS reserved_out,
            SUM(CASE WHEN status = 'EXPIRED' THEN 1 ELSE 0 END) AS expired,
            SUM(CASE WHEN status = 'DRAFT' THEN 1 ELSE 0 END) AS draft
       FROM listings`,
  );
  const reservations = db.get<Record<string, number>>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'RESERVED' THEN 1 ELSE 0 END) AS reserved,
            SUM(CASE WHEN status = 'COLLECTED' THEN 1 ELSE 0 END) AS collected,
            SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled
       FROM reservations`,
  );
  const kgRow = db.get<{ kg: number; quantity: number; pickups: number }>(
    `SELECT COALESCE(SUM(CASE WHEN LOWER(TRIM(unit)) IN ('kg','kgs','kilogram','kilograms','kilo','kilos') THEN quantity ELSE 0 END), 0) AS kg,
            COALESCE(SUM(quantity), 0) AS quantity,
            COUNT(*) AS pickups
       FROM reservations WHERE status = 'COLLECTED'`,
  );

  const months = recentMonthKeys(6);
  const monthlyRows = db.all<{ month: string; pickups: number; kg: number }>(
    `SELECT substr(collected_at, 1, 7) AS month,
            COUNT(*) AS pickups,
            COALESCE(SUM(CASE WHEN LOWER(TRIM(unit)) IN ('kg','kgs','kilogram','kilograms','kilo','kilos') THEN quantity ELSE 0 END), 0) AS kg
       FROM reservations
      WHERE status = 'COLLECTED' AND collected_at IS NOT NULL
      GROUP BY substr(collected_at, 1, 7)`,
  );
  const monthMap = new Map(monthlyRows.map((row) => [row.month, row]));

  const kg = Number(kgRow?.kg ?? 0);
  return {
    organizations: {
      total: Number(org?.total ?? 0),
      pending: Number(org?.pending ?? 0),
      approved: Number(org?.approved ?? 0),
      rejected: Number(org?.rejected ?? 0),
    },
    listings: {
      total: Number(listings?.total ?? 0),
      active: Number(listings?.active ?? 0),
      reservedOut: Number(listings?.reserved_out ?? 0),
      expired: Number(listings?.expired ?? 0),
      draft: Number(listings?.draft ?? 0),
    },
    reservations: {
      total: Number(reservations?.total ?? 0),
      reserved: Number(reservations?.reserved ?? 0),
      collected: Number(reservations?.collected ?? 0),
      cancelled: Number(reservations?.cancelled ?? 0),
    },
    impact: {
      pickups: Number(kgRow?.pickups ?? 0),
      quantity: Math.round(Number(kgRow?.quantity ?? 0) * 100) / 100,
      kg: Math.round(kg * 100) / 100,
      mealsEstimate: mealsEstimate(kg, config),
      kgPerMeal: config.mealsKgPerMeal,
    },
    monthly: months.map((month) => {
      const row = monthMap.get(month);
      return {
        month,
        pickups: Number(row?.pickups ?? 0),
        kg: Math.round(Number(row?.kg ?? 0) * 100) / 100,
      };
    }),
  };
}
