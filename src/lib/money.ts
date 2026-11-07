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

/** Signed display for a single transaction: "-$82.41" / "+$1,500.00". */
export function formatSignedAmount(amount: number): string {
  const cents = toCents(amount);
  const text = currency.format(Math.abs(fromCents(cents)));
  if (cents === 0) return text;
  return cents < 0 ? `-${text}` : `+${text}`;
}
