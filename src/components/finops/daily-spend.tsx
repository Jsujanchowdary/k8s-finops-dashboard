"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { dayLabel, usd } from "@/lib/finops/format";
import { ColumnChart, type Column } from "./charts";

/** Spend per day; click a day to list what was billed on it. */
export function DailySpend({
  columns,
  markers,
  items,
  label,
}: {
  columns: Column[];
  markers: { key: string; text: string }[];
  /** Per day: each line's charge that day. */
  items: Record<string, { description: string; amount: number }[]>;
  label: string;
}) {
  const [day, setDay] = useState<string | null>(null);
  const lines = day ? (items[day] ?? []) : [];
  const total = lines.reduce((a, l) => a + l.amount, 0);

  return (
    <div>
      <ColumnChart columns={columns} markers={markers} xLabelEvery={5} label={label} height={240} selected={day} onSelect={(k) => setDay((d) => (d === k ? null : k))} />
      {day ? (
        <div className="mt-3 rounded-lg border border-border bg-surface-2/50 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm font-medium">
              {dayLabel(day)} <span className="font-normal text-muted">· {usd(total)} billed that day</span>
            </p>
            <button type="button" onClick={() => setDay(null)} aria-label="Close the day's breakdown" className="grid size-6 place-items-center rounded text-muted hover:bg-surface-2 hover:text-text">
              <X className="size-3.5" />
            </button>
          </div>
          {lines.length === 0 ? (
            <p className="text-xs text-muted">Nothing was billed on this day.</p>
          ) : (
            <ul className="space-y-1">
              {lines.map((l) => (
                <li key={l.description} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate font-mono text-[11px]" title={l.description}>{l.description}</span>
                  <span className="shrink-0 tabular-nums">{usd(l.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted">Click a day to see what was billed on it.</p>
      )}
    </div>
  );
}
