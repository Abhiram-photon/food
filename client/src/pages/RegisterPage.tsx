import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../state/AuthContext';
import { errorMessage } from '../api/client';
import { Field } from '../components/ui';
import { PROVIDER_ORG_TYPES, RECIPIENT_ORG_TYPES, type OrgType, type Role } from '@shared';
import { humanizeEnum } from '../lib/format';

const HYDERABAD = { latitude: 17.385, longitude: 78.4867 };

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState<Role>('PROVIDER');
  const [form, setForm] = useState({
    email: '',
    password: '',
    displayName: '',
    organizationName: '',
    organizationType: 'BAKERY' as OrgType,
    phone: '',
    address: '',
    latitude: String(HYDERABAD.latitude),
    longitude: String(HYDERABAD.longitude),
  });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const orgTypes = role === 'PROVIDER' ? PROVIDER_ORG_TYPES : RECIPIENT_ORG_TYPES;

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (!form.email.includes('@')) errors.email = 'Enter a valid email address';
    if (form.password.length < 8) errors.password = 'Password must be at least 8 characters';
    if (form.displayName.trim().length < 2) errors.displayName = 'Tell us your name';
    if (form.organizationName.trim().length < 2)
      errors.organizationName = 'Organization name is required';
    const lat = Number(form.latitude);
    const lng = Number(form.longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90)
      errors.latitude = 'Latitude must be between -90 and 90';
    if (!Number.isFinite(lng) || lng < -180 || lng > 180)
      errors.longitude = 'Longitude must be between -180 and 180';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    setError(null);
    try {
      await register({
        email: form.email.trim().toLowerCase(),
        password: form.password,
        displayName: form.displayName.trim(),
        organizationName: form.organizationName.trim(),
        organizationType: form.organizationType,
        role: role === 'ADMIN' ? 'RECIPIENT' : role,
        phone: form.phone.trim(),
        address: form.address.trim(),
        latitude: Number(form.latitude),
        longitude: Number(form.longitude),
      });
      navigate(role === 'PROVIDER' ? '/provider' : '/recipient', { replace: true });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold tracking-tight text-stone-900">
        Register your organization
      </h1>
      <p className="mt-1 text-sm text-stone-600">
        New accounts start as <strong>pending</strong>. A FreshRelay admin reviews every
        organization before it can publish listings or reserve food.
      </p>

      <form className="fr-card mt-6 space-y-5 p-6" onSubmit={handleSubmit} noValidate>
        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
            {error}
          </p>
        ) : null}

        <fieldset>
          <legend className="fr-label">I am registering as</legend>
          <div className="flex gap-4">
            {(['PROVIDER', 'RECIPIENT'] as const).map((option) => (
              <label key={option} className="flex items-center gap-2 text-sm text-stone-800">
                <input
                  type="radio"
                  name="role"
                  value={option}
                  checked={role === option}
                  onChange={() => {
                    setRole(option);
                    update('organizationType', option === 'PROVIDER' ? 'BAKERY' : 'FOOD_BANK');
                  }}
                  className="h-4 w-4"
                />
                {option === 'PROVIDER'
                  ? 'A food provider (surplus to give)'
                  : 'A recipient (food needed)'}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name" htmlFor="displayName" required error={fieldErrors.displayName}>
            <input
              id="displayName"
              className="fr-input"
              value={form.displayName}
              onChange={(event) => update('displayName', event.target.value)}
              autoComplete="name"
            />
          </Field>
          <Field
            label="Organization name"
            htmlFor="organizationName"
            required
            error={fieldErrors.organizationName}
          >
            <input
              id="organizationName"
              className="fr-input"
              value={form.organizationName}
              onChange={(event) => update('organizationName', event.target.value)}
              autoComplete="organization"
            />
          </Field>
          <Field label="Organization type" htmlFor="organizationType" required>
            <select
              id="organizationType"
              className="fr-input"
              value={form.organizationType}
              onChange={(event) => update('organizationType', event.target.value as OrgType)}
            >
              {orgTypes.map((type) => (
                <option key={type} value={type}>
                  {humanizeEnum(type)}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Phone"
            htmlFor="phone"
            hint="Optional, shared only with matched organizations."
          >
            <input
              id="phone"
              className="fr-input"
              value={form.phone}
              onChange={(event) => update('phone', event.target.value)}
              autoComplete="tel"
            />
          </Field>
          <Field label="Email" htmlFor="email" required error={fieldErrors.email}>
            <input
              id="email"
              type="email"
              className="fr-input"
              value={form.email}
              onChange={(event) => update('email', event.target.value)}
              autoComplete="email"
            />
          </Field>
          <Field
            label="Password"
            htmlFor="password"
            required
            error={fieldErrors.password}
            hint="At least 8 characters."
          >
            <input
              id="password"
              type="password"
              className="fr-input"
              value={form.password}
              onChange={(event) => update('password', event.target.value)}
              autoComplete="new-password"
            />
          </Field>
        </div>

        <Field label="Address" htmlFor="address" hint="Used for pickup routing once approved.">
          <input
            id="address"
            className="fr-input"
            value={form.address}
            onChange={(event) => update('address', event.target.value)}
            autoComplete="street-address"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Latitude" htmlFor="latitude" required error={fieldErrors.latitude}>
            <input
              id="latitude"
              type="number"
              step="0.0001"
              className="fr-input"
              value={form.latitude}
              onChange={(event) => update('latitude', event.target.value)}
            />
          </Field>
          <Field label="Longitude" htmlFor="longitude" required error={fieldErrors.longitude}>
            <input
              id="longitude"
              type="number"
              step="0.0001"
              className="fr-input"
              value={form.longitude}
              onChange={(event) => update('longitude', event.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <button
              type="button"
              className="fr-btn-secondary"
              onClick={() => {
                update('latitude', String(HYDERABAD.latitude));
                update('longitude', String(HYDERABAD.longitude));
              }}
            >
              Use Hyderabad centre
            </button>
          </div>
        </div>

        <button type="submit" className="fr-btn-primary w-full" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>

        <p className="text-sm text-stone-600">
          Already registered?{' '}
          <Link to="/login" className="font-semibold text-emerald-700 underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
