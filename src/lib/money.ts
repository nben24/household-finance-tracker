// Money is summed in integer cents so totals are exact.

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const wholeDollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function formatCents(cents: number): string {
  return currency.format(fromCents(cents));
}

export function formatCentsRounded(cents: number): string {
  return wholeDollars.format(Math.round(fromCents(cents)));
}

/**
 * A rounded amount with its effect spelled out: "+$1,234", "−$300" (a real
 * minus sign, read aloud as "minus"), or "$0".
 */
export function formatEffectRounded(cents: number): string {
  const rounded = Math.round(fromCents(cents));
  if (rounded === 0) return wholeDollars.format(0);
  return `${rounded < 0 ? "−" : "+"}${wholeDollars.format(Math.abs(rounded))}`;
}

/** Signed display for a single transaction: "-$82.41" / "+$1,500.00". */
export function formatSignedAmount(amount: number): string {
  const cents = toCents(amount);
  const text = currency.format(Math.abs(fromCents(cents)));
  if (cents === 0) return text;
  return cents < 0 ? `-${text}` : `+${text}`;
}
