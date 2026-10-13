import type { FastifyInstance } from 'fastify';
import {
  buildAuthResponse,
  capabilitiesFor,
  changePassword,
  createSession,
  destroySession,
  getOrganizationById,
  login,
  register,
  requireSession,
  updateOrganizationProfile,
  toPublicUser,
} from '../services/auth';
import { parseInput } from '../http/validate';
import { requireUser, type AppContext } from '../http/context';
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from '../schemas/auth';

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config } = ctx;

  app.post('/api/auth/register', async (request, reply) => {
    const input = parseInput(registerSchema, request.body);
    const { user, organization } = await register({ db, config }, input);
    const { token, session } = createSession({ db, config }, user.id);
    reply.setCookie(config.sessionCookieName, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      path: '/',
      maxAge: config.sessionTtlHours * 3600,
    });
    reply.code(201);
    return buildAuthResponse({ user, organization, session });
  });

  app.post('/api/auth/login', async (request, reply) => {
    const input = parseInput(loginSchema, request.body);
    const user = await login({ db, config }, input.email, input.password);
    const { token, session } = createSession({ db, config }, user.id);
    const organization = user.organization_id
      ? getOrganizationById(db, user.organization_id)
      : null;
    reply.setCookie(config.sessionCookieName, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.cookieSecure,
      path: '/',
      maxAge: config.sessionTtlHours * 3600,
    });
    return buildAuthResponse({ user, organization, session });
  });

  app.post('/api/auth/logout', async (request, reply) => {
    if (request.sessionUser) destroySession({ db, config }, request.sessionUser.session.id);
    reply.clearCookie(config.sessionCookieName, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (request) => {
    if (!request.sessionUser) return { user: null, csrfToken: null, capabilities: null };
    return buildAuthResponse(request.sessionUser);
  });

  app.patch('/api/auth/profile', async (request) => {
    const sessionUser = requireUser(request);
    const input = parseInput(updateProfileSchema, request.body);
    if (!sessionUser.organization) {
      return {
        user: toPublicUser(sessionUser.user, null),
        capabilities: capabilitiesFor(sessionUser.user, null),
      };
    }
    const organization = updateOrganizationProfile(db, sessionUser.organization.id, input);
    return {
      user: toPublicUser(sessionUser.user, organization),
      capabilities: capabilitiesFor(sessionUser.user, organization),
    };
  });

  app.post('/api/auth/password', async (request) => {
    const sessionUser = requireSession(request.sessionUser);
    const input = parseInput(changePasswordSchema, request.body);
    await changePassword(
      { db, config },
      sessionUser.user.id,
      input.currentPassword,
      input.newPassword,
    );
    return { ok: true };
  });
}
