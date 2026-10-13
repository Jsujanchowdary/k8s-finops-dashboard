import { formatAge } from "@/lib/format";
import type { PodRow } from "./types";

export function withAge(rows: PodRow[], now: number = Date.now()) {
  return rows.map((r) => ({ ...r, age: formatAge(r.createdAt, now) }));
}
