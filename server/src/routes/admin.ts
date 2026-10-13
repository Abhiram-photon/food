import type { FastifyInstance } from 'fastify';
import { requireRoleOnRequest, type AppContext } from '../http/context';
import { listOrganizations, platformTotals, reviewOrganization } from '../services/admin';
import { parseInput } from '../http/validate';
import { adminOrgQuerySchema, reviewOrganizationSchema } from '../schemas/admin';

export function registerAdminRoutes(app: FastifyInstance, ctx: AppContext): void {
  const serviceCtx = { db: ctx.db, config: ctx.config, emailSender: ctx.emailSender };

  app.get('/api/admin/organizations', async (request) => {
    const sessionUser = requireRoleOnRequest(request, 'ADMIN');
    const query = parseInput(adminOrgQuerySchema, request.query ?? {});
    const organizations = listOrganizations(serviceCtx, sessionUser, query);
    return { organizations, count: organizations.length };
  });

  app.post('/api/admin/organizations/:id/review', async (request) => {
    const sessionUser = requireRoleOnRequest(request, 'ADMIN');
    const { id } = request.params as { id: string };
    const body = parseInput(reviewOrganizationSchema, request.body ?? {});
    const organization = reviewOrganization(serviceCtx, sessionUser, id, body.decision, body.note);
    return { organization };
  });

  app.get('/api/admin/totals', async (request) => {
    const sessionUser = requireRoleOnRequest(request, 'ADMIN');
    return platformTotals(serviceCtx, sessionUser);
  });
}
