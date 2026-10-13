import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { errorMessage } from '../api/client';
import { Field } from '../components/ui';

const DEMO_ACCOUNTS = [
  { role: 'Provider', email: 'bakery@freshrelay.dev' },
  { role: 'Recipient', email: 'shelter@freshrelay.dev' },
  { role: 'Admin', email: 'admin@freshrelay.dev' },
];

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const user = await login(email.trim(), password);
      const redirectTo = (location.state as { from?: string } | null)?.from;
      navigate(
        redirectTo ??
          (user.role === 'ADMIN'
            ? '/admin'
            : user.role === 'PROVIDER'
              ? '/provider'
              : '/recipient'),
        {
          replace: true,
        },
      );
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-2xl font-bold tracking-tight text-stone-900">Sign in</h1>
      <p className="mt-1 text-sm text-stone-600">
        Welcome back. Use your organization account to list or reserve food.
      </p>

      <form className="fr-card mt-6 space-y-4 p-6" onSubmit={handleSubmit} noValidate>
        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
            {error}
          </p>
        ) : null}

        <Field label="Email" htmlFor="email" required>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            className="fr-input"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>

        <Field label="Password" htmlFor="password" required>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            className="fr-input"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>

        <button type="submit" className="fr-btn-primary w-full" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="text-sm text-stone-600">
          No account yet?{' '}
          <Link to="/register" className="font-semibold text-emerald-700 underline">
            Register your organization
          </Link>
        </p>
      </form>

      <div className="fr-card mt-4 p-4">
        <h2 className="text-sm font-semibold text-stone-800">Demo accounts (local only)</h2>
        <p className="mt-1 text-xs text-stone-600">
          Password for every seeded account:{' '}
          <code className="rounded bg-stone-100 px-1">Password123!</code>
        </p>
        <ul className="mt-2 space-y-1 text-sm">
          {DEMO_ACCOUNTS.map((account) => (
            <li key={account.email}>
              <button
                type="button"
                className="text-emerald-700 underline"
                onClick={() => {
                  setEmail(account.email);
                  setPassword('Password123!');
                }}
              >
                {account.role}: {account.email}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
