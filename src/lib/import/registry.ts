import { ADAPTERS } from "./adapters";
import type { InstitutionAdapter } from "./types";

/** Institutions with a working adapter, for display on the import screen. */
export const SUPPORTED_INSTITUTIONS = [...new Set(ADAPTERS.map((adapter) => adapter.institution))];

/** Planned for later, alongside net worth tracking. */
export const PLANNED_INSTITUTIONS = ["Vanguard", "Coinbase"];

export function normalizeHeaders(cells: string[]): string[] {
  return cells.map((value) => value.trim().toLowerCase());
}

export function detectAdapter(
  headers: string[],
  adapters: InstitutionAdapter[] = ADAPTERS,
): InstitutionAdapter | null {
  const normalized = normalizeHeaders(headers);
  return adapters.find((adapter) => adapter.matches(normalized)) ?? null;
}
