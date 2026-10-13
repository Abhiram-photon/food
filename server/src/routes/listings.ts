import type { FastifyInstance } from 'fastify';
import { parseInput } from '../http/validate';
import { requireRoleOnRequest, type AppContext } from '../http/context';
import {
  applyStatusAction,
  createListing,
  getListingForViewer,
  listProviderListings,
  searchListings,
  toOwnerListing,
  toPublicListing,
  updateListing,
  sweepStatuses,
} from '../services/listings';
import {
  listingInputSchema,
  listingPatchSchema,
  listingStatusActionSchema,
  searchQuerySchema,
} from '../schemas/listings';
import type { ListingDetailResponse } from '../schemas/listings';
import { capabilitiesFor } from '../services/auth';
import { computeListingStatus } from '../services/listings';
import { toReservationView, listReservationsForProvider } from '../services/reservations';
import { notFound } from '../lib/errors';
import type { ListingRow, ReservationRow } from '../db/types';

export function registerListingRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config } = ctx;

  /** Public search: only ACTIVE, non-expired listings from APPROVED providers. */
  app.get('/api/listings', async (request) => {
    const query = parseInput(searchQuerySchema, request.query);
    sweepStatuses(db);
    return searchListings({ db, config }, query);
  });

  app.get('/api/listings/:id', async (request) => {
    const { id } = request.params as { id: string };
    sweepStatuses(db);
    const { row, isOwner, isAdmin } = getListingForViewer(db, id, request.sessionUser);

    // A recipient who holds a reservation sees the exact pickup address.
    const myReservation = request.sessionUser?.organization
      ? db.get<ReservationRow>(
          `SELECT * FROM reservations
            WHERE listing_id = ? AND recipient_id = ? AND status = 'RESERVED'
            ORDER BY created_at DESC LIMIT 1`,
          [id, request.sessionUser.organization.id],
        )
      : undefined;

    const revealExact = isOwner || isAdmin || Boolean(myReservation);
    const listing = toPublicListing(db, row, { revealExactLocation: revealExact });

    let blockedReason: string | null = null;
    const caps = request.sessionUser
      ? capabilitiesFor(request.sessionUser.user, request.sessionUser.organization)
      : null;
    const status = computeListingStatus(row);
    if (!request.sessionUser)
      blockedReason = 'Sign in as an approved recipient organization to reserve.';
    else if (request.sessionUser.user.role !== 'RECIPIENT')
      blockedReason = 'Only recipient organizations can reserve food.';
    else if (!caps?.canReserve)
      blockedReason = caps?.blockedReason ?? 'Your organization cannot reserve yet.';
    else if (status === 'RESERVED_OUT')
      blockedReason = 'Fully reserved — check back, stock may return.';
    else if (status === 'PAUSED') blockedReason = 'The provider paused this listing.';
    else if (status === 'EXPIRED') blockedReason = 'This listing has expired.';
    else if (status === 'CANCELLED') blockedReason = 'The provider cancelled this listing.';
    else if (status === 'DRAFT') blockedReason = 'This listing is still a draft.';
    else if (row.quantity_remaining <= 0) blockedReason = 'No stock remaining on this listing.';

    const response: ListingDetailResponse = {
      listing,
      reservationBlockedReason: blockedReason,
      canReserve: blockedReason === null,
      isOwner,
      myReservation: myReservation
        ? {
            id: myReservation.id,
            code: toReservationView({ db, config }, myReservation, {
              viewer: request.sessionUser,
              revealCode: true,
            }).code,
            quantity: myReservation.quantity,
            status: myReservation.status,
            pickupStart: myReservation.pickup_start,
            pickupEnd: myReservation.pickup_end,
          }
        : null,
    };
    return response;
  });

  /** Provider: own listings (all statuses). */
  app.get('/api/provider/listings', async (request) => {
    const sessionUser = requireRoleOnRequest(request, 'PROVIDER');
    const { status } = request.query as { status?: string };
    return { listings: listProviderListings({ db, config }, sessionUser, status) };
  });

  app.post('/api/listings', async (request, reply) => {
    const sessionUser = requireRoleOnRequest(request, 'PROVIDER');
    const input = parseInput(listingInputSchema, request.body);
    const listing = createListing({ db, config }, sessionUser, input);
    reply.code(201);
    return { listing };
  });

  app.patch('/api/listings/:id', async (request) => {
    const sessionUser = requireRoleOnRequest(request, 'PROVIDER');
    const { id } = request.params as { id: string };
    const patch = parseInput(listingPatchSchema, request.body);
    return { listing: updateListing({ db, config }, sessionUser, id, patch) };
  });

  app.post('/api/listings/:id/status', async (request) => {
    const sessionUser = requireRoleOnRequest(request, 'PROVIDER');
    const { id } = request.params as { id: string };
    const body = parseInput(listingStatusActionSchema, request.body ?? {});
    const result = applyStatusAction({ db, config }, sessionUser, id, body.action, body.reason);
    return {
      listing: result.listing,
      cancelledReservations: result.cancelledReservations,
    };
  });

  /** Provider: single listing with full detail. */
  app.get('/api/provider/listings/:id', async (request) => {
    const sessionUser = requireRoleOnRequest(request, 'PROVIDER');
    const { id } = request.params as { id: string };
    const row = getListingForViewer(db, id, sessionUser).row as ListingRow;
    if (row.provider_id !== sessionUser.organization?.id) throw notFound('Listing not found.');
    return { listing: toOwnerListing(db, row) };
  });

  app.get('/api/provider/reservations', async (request) => {
    const sessionUser = requireRoleOnRequest(request, 'PROVIDER');
    const { status, listing_id: listingId } = request.query as {
      status?: string;
      listing_id?: string;
    };
    const reservations = listReservationsForProvider(
      { db, config, emailSender: ctx.emailSender },
      sessionUser,
      {
        status,
        listingId,
      },
    );
    return { reservations, count: reservations.length };
  });
}
