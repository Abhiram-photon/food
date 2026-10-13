import { useState } from 'react';
import { useNow } from '../api/hooks';
import { countdownTone, formatCountdown } from '../lib/format';

const TONES: Record<string, string> = {
  urgent: 'bg-red-100 text-red-800 border-red-200',
  soon: 'bg-amber-100 text-amber-900 border-amber-200',
  calm: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  ended: 'bg-stone-200 text-stone-700 border-stone-300',
};

export interface CountdownBadgeProps {
  /** ISO timestamp the countdown counts down to (listing `expiresAt`). */
  expiresAt: string;
  /** Server-provided seconds left; avoids a clock-skew flash on first render. */
  secondsLeft?: number;
  label?: string;
}

/**
 * Live countdown badge. The server's `secondsLeft` seeds the first paint, then a
 * 1-second tick keeps it honest even if the tab stays open for hours.
 */
export function CountdownBadge({ expiresAt, secondsLeft, label }: CountdownBadgeProps) {
  const now = useNow(1000);
  const target = new Date(expiresAt).getTime();
  // The server's `secondsLeft` and the browser clock can disagree by a few seconds;
  // capture that offset once so the badge still ticks down locally.
  const [offset] = useState(() => {
    if (secondsLeft === undefined) return 0;
    const browserSeconds = Math.max(0, Math.floor((target - Date.now()) / 1000));
    return browserSeconds - secondsLeft;
  });
  const computed = Number.isFinite(target)
    ? Math.max(0, Math.floor((target - now.getTime()) / 1000))
    : 0;
  const seconds = Math.max(0, computed - offset);
  const tone = countdownTone(seconds);

  return (
    <span
      className={`fr-badge border ${TONES[tone]}`}
      data-testid="countdown-badge"
      data-tone={tone}
      title={label ? `${label}: ${new Date(expiresAt).toLocaleString()}` : undefined}
    >
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-12.5a.75.75 0 00-1.5 0V10c0 .2.08.39.22.53l2.5 2.5a.75.75 0 101.06-1.06L10.75 9.69V5.5z"
          clipRule="evenodd"
        />
      </svg>
      <span className="tabular-nums">{formatCountdown(seconds)}</span>
    </span>
  );
}
