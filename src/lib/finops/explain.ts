// Plain-language "how was this worked out?" for one invoice line, with the real numbers. Pure, so it is tested
// against the same figures the page shows.

import { usd, usdRate } from "./format";
import { HOURS_CAP, type LineCost } from "./spend";

export interface LineContext {
  /** Hours from where the invoice data stops to the end of the month. */
  hoursLeft: number;
  /** The newest complete day in Billing Insights ("2026-10-12"). */
  lastDay: string;
  /** Tax so far ÷ everything else so far. */
  taxRate: number;
  /** Everything except tax, projected for the month. */
  projectedPretax: number;
}

export interface LineExplanation {
  /** How the hourly rate was found. */
  rate: string;
  /** How the month's figure was projected. */
  projected: string;
  /** Extra context, when there is any. */
  note?: string;
}

const hours = (n: number) => `${Math.round(n * 10) / 10} h`;
const windowHours = (l: LineCost) => (l.start && l.end ? Math.max(0, (Date.parse(l.end) - Date.parse(l.start)) / 3_600_000) : 0);
const day = (iso?: string) => (iso ? new Date(iso).toISOString().slice(0, 10) : "?");

export function explainLine(l: LineCost, ctx: LineContext): LineExplanation {
  if (l.isTax) {
    return {
      rate: `Tax is not billed by the hour: it is ${Math.round(ctx.taxRate * 1000) / 10}% of everything else (${usd(l.amount)} so far).`,
      projected: `Projected tax = ${usd(ctx.projectedPretax)} projected before tax × ${Math.round(ctx.taxRate * 1000) / 10}% = ${usd(l.projected)}`,
    };
  }
  if (l.rate === 0) {
    return {
      rate: l.amount === 0 ? "Free: nothing is charged for this line." : "Billed once, not by the hour.",
      projected: `Stays at ${usd(l.projected)} for the month.`,
    };
  }

  const rate =
    l.rateSource === "hours"
      ? `Rate = ${usd(l.amount)} so far ÷ ${hours(l.duration)} billed = ${usdRate(l.rate)}/h`
      : l.rateSource === "daily"
        ? `Rate = ${usd(l.rate * 24)} charged on ${ctx.lastDay} (the last full day) ÷ 24 = ${usdRate(l.rate)}/h`
        : `Rate = ${usd(l.amount)} so far ÷ ${hours(windowHours(l))} between its start and end = ${usdRate(l.rate)}/h`;

  const note =
    l.rateSource === "daily"
      ? `This line is charged once a day. DigitalOcean reports its duration as "${l.duration} ${l.durationUnit}", but that counts days, so the last day's charge is used instead.`
      : undefined;

  if (!l.running) {
    return { rate, projected: `Stopped on ${day(l.end)}, so it stays at ${usd(l.amount)} for the month.`, note };
  }

  const uncapped = l.amount + l.rate * ctx.hoursLeft;
  const cap = l.rate * HOURS_CAP;
  const capped = uncapped > cap;
  return {
    rate,
    projected: capped
      ? `Projected = the lower of ${usd(l.amount)} + ${usdRate(l.rate)} × ${hours(ctx.hoursLeft)} left = ${usd(uncapped)}, and the ${HOURS_CAP} h monthly cap ${usdRate(l.rate)} × ${HOURS_CAP} = ${usd(cap)}. The cap applies: ${usd(l.projected)}.`
      : `Projected = ${usd(l.amount)} + ${usdRate(l.rate)} × ${hours(ctx.hoursLeft)} left = ${usd(l.projected)} (under the ${HOURS_CAP} h cap of ${usd(cap)}).`,
    note,
  };
}
