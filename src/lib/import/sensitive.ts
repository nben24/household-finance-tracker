import type { CsvRow } from "./types";

// Column names that suggest identifiers we never want to keep.
const SENSITIVE_PATTERNS = [
  /account\s*(number|no\b|num\b|#)/i,
  /acct\s*(number|no\b|num\b|#)/i,
  /card\s*(number|no\b|num\b|#)/i,
  /routing/i,
  /\baba\b/i,
  /\biban\b/i,
  /\bssn\b/i,
  /social\s*security/i,
  /tax\s*(id|payer)/i,
  /\b(tin|ein)\b/i,
  /customer\s*(id|number|no\b|#)/i,
  /member\s*(id|number)/i,
  /user\s*(name|id)/i,
  /login/i,
  /password/i,
];

function normalizeHeader(header: string): string {
  return header.replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
}

export function isSensitiveHeader(header: string): boolean {
  const normalized = normalizeHeader(header);
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function findSensitiveHeaders(headers: string[]): string[] {
  return headers.filter(isSensitiveHeader);
}

/** Drop sensitive columns before a row goes anywhere else. */
export function stripSensitiveFields(row: CsvRow): CsvRow {
  return Object.fromEntries(Object.entries(row).filter(([header]) => !isSensitiveHeader(header)));
}
