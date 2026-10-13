// Parsing for Kubernetes resource quantities ("500m", "2", "512Mi", "1Gi", "128974848").
// CPU quantities parse to cores, memory/storage quantities parse to bytes.

const BINARY: Record<string, number> = {
  Ki: 1024,
  Mi: 1024 ** 2,
  Gi: 1024 ** 3,
  Ti: 1024 ** 4,
  Pi: 1024 ** 5,
  Ei: 1024 ** 6,
};

const DECIMAL: Record<string, number> = {
  n: 1e-9,
  u: 1e-6,
  m: 1e-3,
  "": 1,
  k: 1e3,
  K: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
  P: 1e15,
  E: 1e18,
};

const QUANTITY = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([A-Za-z]*)$/;

/** Returns 0 for empty or unparseable input so callers can sum safely. */
export function parseQuantity(input: string | number | null | undefined): number {
  if (input === null || input === undefined || input === "") return 0;
  if (typeof input === "number") return Number.isFinite(input) ? input : 0;
  const match = QUANTITY.exec(input.trim());
  if (!match) return 0;
  const value = Number(match[1]);
  const suffix = match[2];
  const factor = BINARY[suffix] ?? DECIMAL[suffix];
  if (!Number.isFinite(value) || factor === undefined) return 0;
  return value * factor;
}

export const parseCpu = parseQuantity;
export const parseBytes = parseQuantity;
