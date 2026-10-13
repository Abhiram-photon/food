import { useState } from 'react';
import { formatMonth } from '../lib/format';

export interface BarChartDatum {
  month: string;
  value: number;
  label?: string;
}

export interface BarChartProps {
  data: BarChartDatum[];
  title: string;
  description?: string;
  unit?: string;
  emptyMessage?: string;
}

/**
 * Accessible bar chart built from plain divs (no chart library, no canvas).
 * Values are exposed as text so tests and screen readers can read them.
 */
export function BarChart({
  data,
  title,
  description,
  unit = '',
  emptyMessage = 'No rescued food recorded yet.',
}: BarChartProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const max = Math.max(1, ...data.map((item) => item.value));
  const total = data.reduce((sum, item) => sum + item.value, 0);

  return (
    <section className="fr-card p-5" aria-label={title}>
      <header className="mb-4">
        <h2 className="text-base font-semibold text-stone-900">{title}</h2>
        {description ? <p className="text-sm text-stone-600">{description}</p> : null}
      </header>

      {total === 0 ? (
        <p className="text-sm text-stone-600">{emptyMessage}</p>
      ) : (
        <div className="flex h-48 items-end gap-3" data-testid="bar-chart">
          {data.map((item) => {
            const heightPct = Math.max(2, Math.round((item.value / max) * 100));
            const isHovered = hovered === item.month;
            return (
              <div key={item.month} className="flex flex-1 flex-col items-center justify-end gap-2">
                <span className="text-xs font-semibold tabular-nums text-stone-700">
                  {item.value > 0 ? `${item.value}${unit ? ` ${unit}` : ''}` : ''}
                </span>
                <div
                  className={`w-full rounded-t-md bg-emerald-600 transition-colors ${
                    isHovered ? 'bg-emerald-700' : ''
                  }`}
                  style={{ height: `${heightPct}%`, minHeight: '4px' }}
                  onMouseEnter={() => setHovered(item.month)}
                  onMouseLeave={() => setHovered(null)}
                  title={`${formatMonth(item.month)}: ${item.value}${unit ? ` ${unit}` : ''}`}
                  role="img"
                  aria-label={`${formatMonth(item.month)}: ${item.value}${unit ? ` ${unit}` : ''}`}
                />
                <span className="text-xs text-stone-600">{formatMonth(item.month)}</span>
                <span className="sr-only">
                  {item.label ?? ''} {item.value} {unit}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
