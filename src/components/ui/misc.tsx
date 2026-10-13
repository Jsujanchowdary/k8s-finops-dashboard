import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

export function PageHeader({ title, subtitle, crumbs, actions }: { title: ReactNode; subtitle?: ReactNode; crumbs?: { label: string; href?: string }[]; actions?: ReactNode }) {
  return (
    <div className="mb-5">
      {crumbs?.length ? (
        <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1 text-xs text-muted">
          {crumbs.map((c, i) => (
            <span key={`${c.label}-${i}`} className="flex items-center gap-1">
              {c.href ? <Link href={c.href} className="hover:text-text">{c.label}</Link> : <span className="text-text">{c.label}</span>}
              {i < crumbs.length - 1 ? <ChevronRight className="size-3" /> : null}
            </span>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <div className="mt-1.5 text-sm text-muted">{subtitle}</div> : null}
        </div>
        {actions}
      </div>
    </div>
  );
}

export function KeyValue({ items, columns = 2 }: { items: { label: string; value: ReactNode; mono?: boolean; wide?: boolean }[]; columns?: 1 | 2 | 3 | 4 }) {
  const cols = columns === 1 ? "" : columns === 2 ? "sm:grid-cols-2" : columns === 3 ? "sm:grid-cols-2 xl:grid-cols-3" : "sm:grid-cols-2 xl:grid-cols-4";
  return (
    <dl className={`grid grid-cols-1 gap-x-8 gap-y-3 ${cols}`}>
      {items.map((item) => (
        <div key={item.label} className={`min-w-0 ${item.wide ? "sm:col-span-2" : ""}`}>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">{item.label}</dt>
          <dd className={`mt-0.5 break-words ${item.mono ? "font-mono text-xs" : "text-sm"}`}>{item.value === undefined || item.value === "" ? <span className="text-muted">—</span> : item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Mono({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-xs ${className}`}>{children}</span>;
}

export function Chip({ children }: { children: ReactNode }) {
  return <span className="inline-flex max-w-full items-center truncate rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">{children}</span>;
}

export function CodeBlock({ children, label }: { children: string; label?: string }) {
  return (
    <pre aria-label={label} className="max-h-[70vh] overflow-auto rounded-lg border border-border bg-surface-2 p-4 font-mono text-xs leading-relaxed">
      {children}
    </pre>
  );
}

export function TabLinks({ tabs, active, base }: { tabs: { id: string; label: string; count?: number }[]; active: string; base: string }) {
  return (
    <nav aria-label="Sections" className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <Link
            key={t.id}
            href={t.id === tabs[0].id ? base : `${base}?tab=${t.id}`}
            scroll={false}
            aria-current={on ? "page" : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${on ? "border-accent font-medium text-text" : "border-transparent text-muted hover:text-text"}`}
          >
            {t.label}
            {t.count !== undefined ? <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] tabular-nums text-muted">{t.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
