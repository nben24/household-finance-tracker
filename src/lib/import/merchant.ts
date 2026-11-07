// Turns messy bank descriptions into a readable merchant name.
// Known merchants are matched first; everything else gets a generic clean-up.

import { findKnownMerchant } from "./merchant-library";

const US_STATES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "),
);

// Payment-processor and bank prefixes that say nothing about the merchant.
const NOISE_PREFIX =
  /^(SQ|TST|PP|PAYPAL|SP|PY|FSP|CKE|IC|BT|APLPAY|APPLEPAY|GOOGLEPAY|GGLPAY|POS|DEBIT CARD PURCHASE|POS DEBIT|POS PURCHASE|PURCHASE|CHECKCARD|RECURRING PAYMENT|RECURRING|DEBIT CARD|ACH DEBIT|ACH)\b[\s*\-:]*/;

function titleCase(text: string): string {
  return text
    .toLowerCase()
    .replace(/(^|[\s\-/&.(])([a-z])/g, (_match, before: string, letter: string) => before + letter.toUpperCase())
    .replace(/'S\b/g, "'s");
}

function cleanUp(description: string): string {
  let text = description.toUpperCase();
  for (let pass = 0; pass < 3; pass++) text = text.replace(NOISE_PREFIX, "");
  text = text
    .replace(/\d{2}\/\d{2}(\/\d{2,4})?/g, " ") // embedded dates
    .replace(/#\s*\S*/g, " ") // store numbers and "#location" codes
    .replace(/\S*\d{3,}\S*/g, " ") // reference codes, phone numbers, long ids
    .replace(/[*_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // A trailing state code ("... ALEXANDRIA VA") is location, not name.
  const words = text.split(" ");
  if (words.length > 2 && US_STATES.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

/**
 * The other person in a Zelle or Venmo payment, in the layouts banks use:
 *   Truist: "SAM RIVERA PAYMENT ID ABC123 ZELLE PAYMENT TO"
 *   Bank of America: "ZELLE PAYMENT FROM SAM RIVERA FOR RENT CONF# 123"
 *   Chase: "Zelle payment to SAM RIVERA 12345"
 *   Venmo: "VENMO *SAM RIVERA"
 */
export function paymentAppPerson(description: string): { app: "Zelle" | "Venmo"; person: string | null } | null {
  const text = description.toUpperCase().replace(/\s+/g, " ").trim();
  const app = text.includes("ZELLE") ? "Zelle" : text.includes("VENMO") ? "Venmo" : null;
  if (!app) return null;

  const candidates = [
    /^(.+?) PAYMENT ID \S+ ZELLE/.exec(text)?.[1],
    /ZELLE (?:PAYMENT |TRANSFER )?(?:TO|FROM):? (.+)$/.exec(text)?.[1],
    /VENMO\s*\*\s*(.+)$/.exec(text)?.[1],
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const words: string[] = [];
    for (const word of candidate.split(" ")) {
      if (/\d/.test(word) || ["FOR", "CONF#", "CONF", "REF", "ID", "ON", "MEMO", "PAYMENT"].includes(word)) break;
      words.push(word);
    }
    const name = words.slice(0, 3).join(" ").replace(/[^A-Z .'&-]/g, "").trim();
    if (name.length >= 2) return { app, person: titleCase(name) };
  }
  return { app, person: null };
}

export function normalizeMerchant(description: string, bankMerchantName?: string | null): string {
  // Keep the person for payment apps, so the app can learn per person
  // ("Zelle · Riley" is a donation; "Zelle · Jane" is something else).
  const payment = paymentAppPerson(description);
  if (payment) return payment.person ? `${payment.app} · ${payment.person}` : payment.app;

  for (const candidate of [bankMerchantName ?? "", description]) {
    const known = candidate && findKnownMerchant(candidate);
    if (known) return known.name;
  }
  const cleaned = cleanUp(bankMerchantName?.trim() || description) || cleanUp(description);
  const name = titleCase(cleaned).slice(0, 60).trim();
  return name || description.trim().slice(0, 60);
}
