// One adapter per bank export layout. Header names are compared lowercased.
// Each adapter's only jobs are to recognize its header row and to convert a
// row into a NormalizedTransaction (negative = money out).

import type { TransactionType } from "@/lib/db/types";
import type { CsvRow, InstitutionAdapter, ParseResult } from "./types";
import { hasExplicitSign, parseAmount, parseDate } from "./values";

const hasAll = (headers: string[], ...names: string[]) => names.every((name) => headers.includes(name));

interface Fields {
  date: string;
  postingDate?: string;
  description: string;
  amount: number | null;
  typeHint?: TransactionType | null;
  sourceId?: string;
  merchantHint?: string;
  bankCategory?: string;
  balance?: string;
}

function build(fields: Fields): ParseResult {
  const transactionDate = parseDate(fields.date);
  if (!transactionDate) return { kind: "problem", problem: `Couldn't read the date "${fields.date}"` };
  if (fields.amount === null) return { kind: "problem", problem: "Couldn't read the amount" };
  const description = fields.description.replace(/\s+/g, " ").trim();
  if (!description) return { kind: "problem", problem: "The description is empty" };
  return {
    kind: "transaction",
    transaction: {
      transactionDate,
      postingDate: fields.postingDate ? parseDate(fields.postingDate) : null,
      originalDescription: description,
      amount: fields.amount,
      transactionTypeHint: fields.typeHint ?? null,
      sourceId: fields.sourceId?.replace(/['"\s]/g, "") || null,
      merchantHint: fields.merchantHint?.trim() || null,
      bankCategory: fields.bankCategory?.replace(/\s+/g, " ").trim() || null,
      balance: fields.balance ? parseAmount(fields.balance) : null,
    },
  };
}

const cell = (row: CsvRow, name: string) => row[name] ?? "";

// Posted Date, Transaction Date, Transaction Type, Check/Serial #, Full description,
// Merchant name, Category name, Sub-category name, Amount, Daily Posted Balance
const truist: InstitutionAdapter = {
  id: "truist",
  institution: "Truist",
  accountTypes: ["checking", "savings", "credit_card"],
  matches: (headers) => hasAll(headers, "posted date", "transaction date", "full description", "amount"),
  parseRow(row) {
    const amountText = cell(row, "amount");
    let amount = parseAmount(amountText);
    // If the amount carries no sign of its own, the type column decides direction.
    if (amount !== null && !hasExplicitSign(amountText)) {
      const type = cell(row, "transaction type").toLowerCase();
      if (/debit|pos|purchase|fee|check|withdraw|payment/.test(type) && !/credit|deposit/.test(type)) {
        amount = -amount;
      }
    }
    return build({
      date: cell(row, "transaction date") || cell(row, "posted date"),
      postingDate: cell(row, "posted date"),
      description: cell(row, "full description") || cell(row, "merchant name"),
      amount,
      merchantHint: cell(row, "merchant name"),
      bankCategory: [cell(row, "category name"), cell(row, "sub-category name")]
        .map((part) => part.trim())
        .filter(Boolean)
        .join(" / "),
      balance: cell(row, "daily posted balance"),
    });
  },
};

// Date, Description, Amount, Extended Details, Appears On Your Statement As,
// Address, City/State, Zip Code, Country, Reference, Category
// Amex lists charges as positive and payments/credits as negative.
const amex: InstitutionAdapter = {
  id: "amex",
  institution: "American Express",
  accountTypes: ["credit_card"],
  matches: (headers) =>
    hasAll(headers, "date", "description", "amount") &&
    ["extended details", "appears on your statement as", "reference", "card member"].some((name) =>
      headers.includes(name),
    ),
  parseRow(row) {
    const amount = parseAmount(cell(row, "amount"));
    return build({
      date: cell(row, "date"),
      description: cell(row, "appears on your statement as") || cell(row, "description"),
      amount: amount === null ? null : -amount,
      sourceId: cell(row, "reference"),
      merchantHint: cell(row, "description"),
      bankCategory: cell(row, "category"),
    });
  },
};

// Details, Posting Date, Description, Amount, Type, Balance, Check or Slip #
const chaseChecking: InstitutionAdapter = {
  id: "chase-checking",
  institution: "Chase",
  accountTypes: ["checking", "savings"],
  matches: (headers) => hasAll(headers, "details", "posting date", "description", "amount", "type"),
  parseRow(row) {
    const type = cell(row, "type").toUpperCase();
    return build({
      date: cell(row, "posting date"),
      postingDate: cell(row, "posting date"),
      description: cell(row, "description"),
      amount: parseAmount(cell(row, "amount")),
      typeHint: type === "ACCT_XFER" ? "transfer" : null,
    });
  },
};

// Transaction Date, Post Date, Description, Category, Type, Amount, Memo
const chaseCard: InstitutionAdapter = {
  id: "chase-card",
  institution: "Chase",
  accountTypes: ["credit_card"],
  matches: (headers) => hasAll(headers, "transaction date", "post date", "description", "type", "amount"),
  parseRow(row) {
    const type = cell(row, "type").toLowerCase();
    const typeHint: TransactionType | null =
      type === "payment" ? "credit_card_payment" : type === "return" ? "refund" : null;
    return build({
      date: cell(row, "transaction date"),
      postingDate: cell(row, "post date"),
      description: cell(row, "description"),
      amount: parseAmount(cell(row, "amount")),
      typeHint,
    });
  },
};

// A summary block comes first; the real header is: Date, Description, Amount, Running Bal.
const bofaChecking: InstitutionAdapter = {
  id: "bofa-checking",
  institution: "Bank of America",
  accountTypes: ["checking", "savings"],
  matches: (headers) => hasAll(headers, "date", "description", "amount", "running bal."),
  parseRow(row) {
    if (/^beginning balance/i.test(cell(row, "description")) && cell(row, "amount").trim() === "") {
      return { kind: "skip" };
    }
    return build({
      date: cell(row, "date"),
      description: cell(row, "description"),
      amount: parseAmount(cell(row, "amount")),
      balance: cell(row, "running bal."),
    });
  },
};

// Posted Date, Reference Number, Payee, Address, Amount
const bofaCard: InstitutionAdapter = {
  id: "bofa-card",
  institution: "Bank of America",
  accountTypes: ["credit_card"],
  matches: (headers) => hasAll(headers, "posted date", "reference number", "payee", "amount"),
  parseRow(row) {
    return build({
      date: cell(row, "posted date"),
      postingDate: cell(row, "posted date"),
      description: cell(row, "payee"),
      amount: parseAmount(cell(row, "amount")),
      sourceId: cell(row, "reference number"),
    });
  },
};

export const ADAPTERS: InstitutionAdapter[] = [
  truist,
  amex,
  chaseChecking,
  chaseCard,
  bofaChecking,
  bofaCard,
];

/** Layouts we recognize but deliberately don't import yet. */
export const UNSUPPORTED_LAYOUTS: { matches(headers: string[]): boolean; message: string }[] = [
  {
    matches: (headers) => hasAll(headers, "trade date", "cusip", "tran code"),
    message:
      "This looks like an investment account export (trades and holdings). Investment accounts aren't supported yet — only checking, savings and credit card activity.",
  },
];
