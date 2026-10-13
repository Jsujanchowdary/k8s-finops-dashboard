import type { ReactNode } from "react";
import { ChevronDown, Search } from "lucide-react";

// Shared toolbar controls. They all use the same height (h-8) so rows of mixed controls line up.

export const FIELD = "h-8 rounded-md border border-border bg-surface px-2.5 text-sm text-text focus:border-accent focus:outline-none disabled:opacity-50";
export const BUTTON = "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-surface px-2.5 text-xs font-medium text-text transition-colors hover:bg-surface-2 disabled:opacity-50";
export const toggleClass = (on: boolean) => `${BUTTON} ${on ? "border-accent/50 bg-accent/15" : "text-muted hover:text-text"}`;

export function SearchField({ value, onChange, placeholder, label, className = "" }: { value: string; onChange: (value: string) => void; placeholder: string; label: string; className?: string }) {
  return (
    <label className={`relative min-w-52 flex-1 ${className}`}>
      <span className="sr-only">{label}</span>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted" aria-hidden />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={`${FIELD} w-full pl-8 placeholder:text-muted`} />
    </label>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  disabled,
  children,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      <span>{label}</span>
      <span className="relative">
        <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={`${FIELD} appearance-none pr-7`}>
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted" aria-hidden />
      </span>
    </label>
  );
}

/** A group of mutually exclusive choices, shown as one joined control, optionally with counts. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-8 items-center rounded-md border border-border bg-surface p-0.5">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.id)}
            className={`inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded px-2.5 text-xs font-medium transition-colors ${on ? "bg-accent/20 text-text" : "text-muted hover:text-text"}`}
          >
            {o.label}
            {o.count !== undefined ? <span className={`tabular-nums ${on ? "text-text/70" : "text-muted/70"}`}>{o.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
