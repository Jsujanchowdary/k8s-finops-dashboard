import { percent } from "@/lib/format";

/** When live data refreshes, bars slide to the new value instead of jumping (CSS transitions never run on first paint). */
const SLIDE = "transition-[width,left,background-color] duration-500 ease-out motion-reduce:transition-none";

/**
 * A bar showing usage against a ceiling, with an optional marker for the request.
 * Everything is in the same unit (cores or bytes). `max` is the 100% point.
 * The request is a light band plus a tick drawn on top of the usage bar, so it stays visible when usage goes past it.
 * Orange and red mean "close to the ceiling", so turn `colorize` off when the ceiling is not a real limit
 * (a pod without a limit has nothing to be close to).
 */
export function Meter({
  usage,
  request,
  max,
  height = "h-2",
  label,
  colorize = true,
}: {
  usage: number | null;
  request?: number;
  max: number;
  height?: string;
  label?: string;
  colorize?: boolean;
}) {
  const used = usage === null ? 0 : percent(usage, max);
  const req = request ? percent(request, max) : 0;
  const hot = colorize && used >= 90;
  const warm = colorize && used >= 75;
  return (
    <div role="meter" aria-label={label} aria-valuenow={Math.round(used)} aria-valuemin={0} aria-valuemax={100} className={`relative w-full overflow-hidden rounded-full bg-surface-2 ${height}`}>
      {req > 0 ? <div className={`absolute inset-y-0 left-0 bg-accent/25 ${SLIDE}`} style={{ width: `${req}%` }} /> : null}
      {usage !== null ? <div className={`absolute inset-y-0 left-0 rounded-full ${hot ? "bg-danger" : warm ? "bg-warning" : "bg-accent"} ${SLIDE}`} style={{ width: `${Math.max(used, usage > 0 ? 1.5 : 0)}%` }} /> : null}
      {req > 0 ? <div aria-hidden title="request" className={`absolute inset-y-0 w-0.5 bg-text/70 ${SLIDE}`} style={{ left: `clamp(0px, calc(${req}% - 1px), calc(100% - 2px))` }} /> : null}
    </div>
  );
}

/**
 * The 100% point for a usage-vs-request bar: the limit when there is one (a real ceiling), otherwise a quarter more
 * than the larger of request and usage, so both the request tick and the usage bar fit with some room.
 * `colorize` is only true for a real limit.
 */
export function requestScale(value: { request: number; limit: number; usage: number | null }, useLimit = true): { max: number; colorize: boolean } {
  if (useLimit && value.limit > 0) return { max: value.limit, colorize: true };
  return { max: Math.max(value.request, value.usage ?? 0) * 1.25, colorize: false };
}

/** Usage above the request: shown in amber next to the bar. */
export function overRequest(value: { request: number; usage: number | null }): boolean {
  return value.request > 0 && value.usage !== null && value.usage > value.request;
}
