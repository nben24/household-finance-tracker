import { isISODate } from "@/lib/dates";

/**
 * Reads amounts as banks write them: "$1,234.56", "-12.34", "(12.34)",
 * "+5.00". Returns null when the text is not a number.
 */
export function parseAmount(text: string): number | null {
  let value = text.trim().replace(/−/g, "-");
  if (value === "") return null;
  let negative = false;
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }
  value = value.replace(/[$,\s]/g, "");
  if (value.startsWith("-")) {
    negative = !negative;
    value = value.slice(1);
  } else if (value.startsWith("+")) {
    value = value.slice(1);
  }
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(value)) return null;
  const amount = Math.round(Number(value) * 100) / 100;
  return negative ? -amount : amount;
}

/** True when the text carries its own sign ("-", "+", or accounting parentheses). */
export function hasExplicitSign(text: string): boolean {
  return /^\s*[-+−(]/.test(text);
}

/** Accepts MM/DD/YYYY, M/D/YY and YYYY-MM-DD; returns YYYY-MM-DD or null. */
export function parseDate(text: string): string | null {
  const value = text.trim();
  let iso: string | null = null;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(value);
  if (us) {
    const year = us[3].length === 2 ? `20${us[3]}` : us[3];
    iso = `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  } else if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    iso = value.slice(0, 10);
  }
  if (!iso || !isISODate(iso)) return null;
  // reject impossible days such as 02/30 that Date would roll forward
  return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null;
}
