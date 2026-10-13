import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../lib/crypto';
import { createTestHarness, inject, type TestHarness } from './helpers';

describe('password hashing', () => {
  it('hashes with scrypt and verifies the original password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(hash).not.toContain('correct horse');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('wrong password', hash)).toBe(false);
  });

  it('produces a unique salt per hash', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toEqual(b);
    expect(await verifyPassword('same-password', a)).toBe(true);
    expect(await verifyPassword('same-password', b)).toBe(true);
  });

  it('rejects malformed stored hashes instead of throwing', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$1$2$3$4')).toBe(false);
  });
});

describe('auth HTTP flow', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('registers an organization in PENDING state and starts a session', async () => {
    const response = await inject(harness.app, {
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'new-bakery@example.com',
        password: 'Password123!',
        displayName: 'New Baker',
        organizationName: 'New Bakery',
        organizationType: 'BAKERY',
        role: 'PROVIDER',
        latitude: 17.385,
        longitude: 78.4867,
      },
    });
    expect(response.status).toBe(201);
    expect(response.body.user.organizationStatus).toBe('PENDING');
    expect(response.body.capabilities.canPublishListing).toBe(false);
    expect(response.body.capabilities.blockedReason).toContain('pending');

    const setCookie = response.headers['set-cookie'];
    expect(setCookie).toBeDefined();
  });

  it('sets an httpOnly, SameSite=Lax session cookie', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { 'x-requested-with': 'test' },
      payload: {
        email: 'cookie-check@example.com',
        password: 'Password123!',
        displayName: 'Cookie Check',
        organizationName: 'Cookie Org',
        organizationType: 'FOOD_BANK',
        role: 'RECIPIENT',
      },
    });
    const setCookie = response.headers['set-cookie'];
    const raw = Array.isArray(setCookie) ? setCookie.join(';') : String(setCookie);
    expect(raw).toContain('HttpOnly');
    expect(raw).toContain('SameSite=Lax');
    expect(raw.toLowerCase()).toContain('fr_session=');
  });

  it('rejects duplicate emails', async () => {
    const payload = {
      email: 'duplicate@example.com',
      password: 'Password123!',
      displayName: 'Dup',
      organizationName: 'Dup Org',
      organizationType: 'BAKERY',
      role: 'PROVIDER',
    };
    const first = await inject(harness.app, { method: 'POST', url: '/api/auth/register', payload });
    expect(first.status).toBe(201);
    const second = await inject(harness.app, { method: 'POST', url: '/api/auth/register', payload });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('logs in with the right password and rejects the wrong one', async () => {
    const registered = await inject(harness.app, {
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'login-flow@example.com',
        password: 'Password123!',
        displayName: 'Login Flow',
        organizationName: 'Login Org',
        organizationType: 'BAKERY',
        role: 'PROVIDER',
      },
    });
    expect(registered.status).toBe(201);

    const bad = await inject(harness.app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'login-flow@example.com', password: 'nope' },
    });
    expect(bad.status).toBe(401);

    const unknown = await inject(harness.app, {
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nobody@example.com', password: 'nope' },
    });
    expect(unknown.status).toBe(401);

    const good = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-requested-with': 'test' },
      payload: { email: 'login-flow@example.com', password: 'Password123!' },
    });
    expect(good.statusCode).toBe(200);
    const cookie = good.headers['set-cookie'];
    const raw = Array.isArray(cookie) ? cookie.join(';') : String(cookie);
    const sessionCookie = raw.split(';')[0]!;

    const me = await inject(harness.app, { url: '/api/auth/me', cookie: sessionCookie });
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('login-flow@example.com');

    const logout = await inject(harness.app, {
      method: 'POST',
      url: '/api/auth/logout',
      cookie: sessionCookie,
    });
    expect(logout.status).toBe(200);

    const afterLogout = await inject(harness.app, { url: '/api/auth/me', cookie: sessionCookie });
    expect(afterLogout.status).toBe(200);
    expect(afterLogout.body.user).toBeNull();
  });

  it('requires the X-Requested-With CSRF header on mutating requests', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'irrelevant@example.com', password: 'x' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('CSRF_HEADER_MISSING');
  });

  it('rejects a mismatched CSRF token when one is supplied with a live session', async () => {
    await inject(harness.app, {
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'csrf-check@example.com',
        password: 'Password123!',
        displayName: 'CSRF Check',
        organizationName: 'CSRF Org',
        organizationType: 'BAKERY',
        role: 'PROVIDER',
      },
    });
    const login = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-requested-with': 'test' },
      payload: { email: 'csrf-check@example.com', password: 'Password123!' },
    });
    const rawCookie = login.headers['set-cookie'];
    const plain = Array.isArray(rawCookie) ? rawCookie.join(';') : String(rawCookie);
    const sessionCookie = plain.split(';')[0]!;

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        cookie: sessionCookie,
        'x-requested-with': 'test',
        'x-csrf-token': 'definitely-wrong',
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('CSRF_TOKEN_MISMATCH');
  });

  it('returns 401 for protected endpoints without a session', async () => {
    const impact = await inject(harness.app, { url: '/api/impact' });
    expect(impact.status).toBe(401);
    const reservations = await inject(harness.app, { url: '/api/reservations' });
    expect(reservations.status).toBe(401);
  });

  it('validates the registration payload', async () => {
    const response = await inject(harness.app, {
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'not-an-email', password: 'short', displayName: 'x', role: 'PROVIDER' },
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
