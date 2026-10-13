"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { niceTicks, usd, usdShort } from "@/lib/finops/format";

// Small hand-built SVG charts in the dashboard's own colours (theme tokens, so light and dark both work).
// One accent hue for the series that matters, gray for context. Every value is also in a table on the page.

const PAD = { top: 16, right: 64, bottom: 28, left: 52 };

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  // Kept inside the chart: flips to the left of the pointer near the right edge.
  const left = x > width - 180 ? x - 172 : x + 12;
  return (
    <div role="status" className="pointer-events-none absolute z-10 min-w-36 rounded-md border border-border bg-surface px-2.5 py-2 text-xs shadow-lg" style={{ left: Math.max(0, left), top: Math.max(0, y) }}>
      {children}
    </div>
  );
}

function TooltipRow({ value, label, swatch }: { value: string; label: string; swatch?: "accent" | "muted" }) {
  return (
    <div className="flex items-center gap-2">
      {swatch ? <span aria-hidden className={`h-0.5 w-3 rounded-full ${swatch === "accent" ? "bg-accent" : "bg-muted"}`} /> : null}
      <span className="font-semibold tabular-nums text-text">{value}</span>
      <span className="text-muted">{label}</span>
    </div>
  );
}

function YAxis({ ticks, y, x2 }: { ticks: number[]; y: (v: number) => number; x2: number }) {
  return (
    <g aria-hidden>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={x2} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
          <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">{usdShort(t)}</text>
        </g>
      ))}
    </g>
  );
}

/**
 * Cumulative spend by day of month: this month (accent) against last month (gray).
 * A crosshair snaps to the nearest day and the tooltip lists both months.
 */
export function CumulativeChart({ current, previous, currentLabel, previousLabel, days: monthDays, height = 240 }: { current: number[]; previous: number[]; currentLabel: string; previousLabel: string; /** Days in the current month. */ days: number; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const days = Math.max(Number.isFinite(monthDays) ? monthDays : 0, current.length, previous.length, 2);
  const max = Math.max(1, ...current, ...previous);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const plotW = Math.max(1, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const x = (day: number) => PAD.left + ((day - 1) / Math.max(1, days - 1)) * plotW;
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const path = (values: number[]) => values.map((v, i) => `${i ? "L" : "M"}${x(i + 1).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const xTicks = [1, 8, 15, 22, days];

  const pick = (clientX: number, rect: DOMRect) => {
    const day = Math.round(((clientX - rect.left - PAD.left) / plotW) * (days - 1)) + 1;
    setHover(Math.min(days, Math.max(1, day)));
  };

  const end = (values: number[]) => (values.length ? { day: values.length, value: values[values.length - 1] } : null);
  const curEnd = end(current);
  const prevEnd = end(previous);
  // Keep the two end labels apart when the lines finish close together.
  const labelGap = curEnd && prevEnd && Math.abs(x(curEnd.day) - x(prevEnd.day)) < 60 && Math.abs(y(curEnd.value) - y(prevEnd.value)) < 14;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-muted" aria-hidden>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full bg-accent" />{currentLabel}</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full bg-muted" />{previousLabel}</span>
      </div>
      <div ref={ref} className="relative" style={{ height }}>
        {width > 0 ? (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={`Cumulative spend by day: ${currentLabel} ${usd(curEnd?.value)} after ${curEnd?.day ?? 0} days; ${previousLabel} ${usd(prevEnd?.value)} for the whole month.`}
            tabIndex={0}
            className="outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover(curEnd?.day ?? 1)}
            onBlur={() => setHover(null)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") setHover((h) => Math.min(days, (h ?? 0) + 1));
              if (e.key === "ArrowLeft") setHover((h) => Math.max(1, (h ?? 2) - 1));
            }}
          >
            <YAxis ticks={ticks} y={y} x2={width - PAD.right} />
            {xTicks.map((d) => (
              <text key={d} x={x(d)} y={height - 8} textAnchor="middle" className="fill-muted text-[11px] tabular-nums" aria-hidden>{d}</text>
            ))}
            <path d={path(previous)} fill="none" stroke="var(--muted)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" opacity={0.7} />
            <path d={path(current)} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {prevEnd ? (
              <text x={x(prevEnd.day) + 8} y={y(prevEnd.value) + (labelGap ? 10 : 0)} dy="0.32em" className="fill-muted text-[11px] tabular-nums" aria-hidden>{usd(prevEnd.value)}</text>
            ) : null}
            {curEnd ? (
              <g aria-hidden>
                <circle cx={x(curEnd.day)} cy={y(curEnd.value)} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
                <text x={x(curEnd.day) + 8} y={y(curEnd.value) - (labelGap ? 10 : 0)} dy="0.32em" className="fill-text text-[11px] font-medium tabular-nums">{usd(curEnd.value)}</text>
              </g>
            ) : null}
            {hover !== null ? (
              <g aria-hidden>
                <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--muted)" strokeWidth={1} opacity={0.6} />
                {current[hover - 1] !== undefined ? <circle cx={x(hover)} cy={y(current[hover - 1])} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} /> : null}
                {previous[hover - 1] !== undefined ? <circle cx={x(hover)} cy={y(previous[hover - 1])} r={4} fill="var(--muted)" stroke="var(--surface)" strokeWidth={2} /> : null}
              </g>
            ) : null}
          </svg>
        ) : null}
        {hover !== null && width > 0 ? (
          <Tooltip x={x(hover)} y={PAD.top} width={width}>
            <p className="mb-1 text-muted">Day {hover}, running total</p>
            <TooltipRow value={current[hover - 1] !== undefined ? usd(current[hover - 1]) : "not yet"} label={currentLabel} swatch="accent" />
            <TooltipRow value={previous[hover - 1] !== undefined ? usd(previous[hover - 1]) : "—"} label={previousLabel} swatch="muted" />
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}

export interface Readout {
  title: string;
  rows: { value: string; label: string; swatch?: "accent" | "muted" }[];
}

export interface Column {
  key: string;
  /** Axis and tooltip label. */
  label: string;
  value: number | null;
  /** A lighter extension on top of `value`, e.g. the projected rest of the month. */
  extra?: number;
  /** Shown at the top of the column. */
  cap?: string;
  tooltip?: Readout;
}

/**
 * Columns from a single baseline, ≤ 24px wide, 4px rounded tops. One hue; `extra` stacks a lighter step of it.
 * Each column is its own hover and focus target, taller and wider than the painted mark.
 */
export function ColumnChart({
  columns,
  height = 200,
  label,
  markers = [],
  xLabelEvery = 1,
  selected = null,
  onSelect,
}: {
  columns: Column[];
  height?: number;
  label: string;
  markers?: { key: string; text: string }[];
  xLabelEvery?: number;
  /** The column picked by a click; the others are dimmed. */
  selected?: string | null;
  /** Makes columns with data clickable (Enter or Space with the keyboard). */
  onSelect?: (key: string) => void;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...columns.map((c) => (c.value ?? 0) + (c.extra ?? 0)));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const right = 16;
  const plotW = Math.max(1, width - PAD.left - right);
  const plotH = height - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(1, columns.length);
  const barW = Math.min(24, Math.max(2, slot - 2));
  const cx = (i: number) => PAD.left + slot * i + slot / 2;
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const base = PAD.top + plotH;

  // A bar with a 4px rounded top and a square foot.
  const bar = (xMid: number, y0: number, y1: number) => {
    const h = y0 - y1;
    if (h <= 0) return "";
    const r = Math.min(4, h, barW / 2);
    const l = xMid - barW / 2;
    const rr = xMid + barW / 2;
    return `M${l},${y0}V${y1 + r}Q${l},${y1} ${l + r},${y1}H${rr - r}Q${rr},${y1} ${rr},${y1 + r}V${y0}Z`;
  };

  return (
    <div ref={ref} className="relative" style={{ height }}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={label}>
          <YAxis ticks={ticks} y={y} x2={width - right} />
          {columns.map((c, i) => {
            const v = c.value ?? 0;
            const total = v + (c.extra ?? 0);
            const marker = markers.find((m) => m.key === c.key);
            const picked = selected === c.key;
            const on = hover === i || picked;
            const faded = selected !== null && !picked;
            const clickable = onSelect && c.value !== null;
            return (
              <g key={c.key}>
                {marker ? (
                  <g aria-hidden>
                    <line x1={cx(i) - slot / 2} x2={cx(i) - slot / 2} y1={PAD.top} y2={base} stroke="var(--warning)" strokeWidth={1} />
                    <text x={cx(i) - slot / 2 + 4} y={PAD.top + 4} dy="0.7em" className="fill-muted text-[11px]">{marker.text}</text>
                  </g>
                ) : null}
                {c.extra ? <path d={bar(cx(i), y(v) + (v > 0 ? 2 : 0), y(total))} fill="var(--accent)" opacity={faded ? 0.15 : on ? 0.45 : 0.3} /> : null}
                {v > 0 ? <path d={bar(cx(i), base, y(v))} fill="var(--accent)" opacity={faded ? 0.35 : on ? 1 : 0.85} /> : null}
                {c.cap ? <text x={cx(i)} y={y(total) - 6} textAnchor="middle" className="fill-text text-[11px] tabular-nums" aria-hidden>{c.cap}</text> : null}
                {i % xLabelEvery === 0 || i === columns.length - 1 ? (
                  <text x={cx(i)} y={height - 8} textAnchor="middle" className="fill-muted text-[11px] tabular-nums" aria-hidden>{c.label}</text>
                ) : null}
                <rect
                  x={cx(i) - slot / 2}
                  y={PAD.top}
                  width={slot}
                  height={plotH}
                  fill="transparent"
                  tabIndex={0}
                  role={clickable ? "button" : "img"}
                  aria-pressed={clickable ? picked : undefined}
                  aria-label={`${c.label}: ${c.value === null ? "no data" : usd(c.value)}${c.extra ? `, ${usd(c.extra)} more projected` : ""}${clickable ? ". Show what was billed" : ""}`}
                  className={`outline-none focus-visible:stroke-accent ${clickable ? "cursor-pointer" : ""}`}
                  onClick={clickable ? () => onSelect(c.key) : undefined}
                  onKeyDown={
                    clickable
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSelect(c.key);
                          }
                        }
                      : undefined
                  }
                  onPointerEnter={() => setHover(i)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                />
              </g>
            );
          })}
          <line x1={PAD.left} x2={width - right} y1={base} y2={base} stroke="var(--border)" strokeWidth={1} aria-hidden />
        </svg>
      ) : null}
      {hover !== null && width > 0 ? (
        <Tooltip x={cx(hover)} y={PAD.top} width={width}>
          {(() => {
            const c = columns[hover];
            const readout = c.tooltip ?? { title: c.label, rows: [{ value: c.value === null ? "no data" : usd(c.value), label: "" }] };
            return (
              <>
                <p className="mb-1 text-muted">{readout.title}</p>
                {readout.rows.map((r) => <TooltipRow key={r.label} {...r} />)}
              </>
            );
          })()}
        </Tooltip>
      ) : null}
    </div>
  );
}
