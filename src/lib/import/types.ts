// CSV import pipeline.
//
//   In the browser (the raw file never leaves the device):
//     raw CSV → parse → find header row → detect institution
//             → drop sensitive columns → institution adapter → NormalizedTransaction
//   On the server:
//     validate → classify type → normalize merchant → fingerprint → skip duplicates → save

import type { AccountType, TransactionType } from "@/lib/db/types";

/** One CSV row as lowercased header → cell text, after sensitive columns are removed. */
export type CsvRow = Record<string, string>;

/** The single internal shape every institution's rows are converted into. */
export interface NormalizedTransaction {
  transactionDate: string; // YYYY-MM-DD
  postingDate: string | null;
  originalDescription: string;
  /** negative = money out, positive = money in, regardless of the bank's convention */
  amount: number;
  /** set when the file itself says so (e.g. a "Payment" type column) */
  transactionTypeHint: TransactionType | null;
  /** bank-provided reference id when available; only ever used for the duplicate fingerprint */
  sourceId: string | null;
  /** bank-provided cleaned-up merchant name, when the export has one */
  merchantHint: string | null;
  /** the bank's own category label, when the export has one; used as a fallback suggestion */
  bankCategory: string | null;
  /** the account balance the export shows after this row, when it has one (never sent to the server per row) */
  balance?: number | null;
}

export type ParseResult =
  | { kind: "transaction"; transaction: NormalizedTransaction }
  /** a row that is legitimately not a transaction (e.g. "Beginning balance") */
  | { kind: "skip" }
  | { kind: "problem"; problem: string };

export interface InstitutionAdapter {
  id: string;
  /** Shown to the user, e.g. "American Express". */
  institution: string;
  /** Account types this export comes from; used to suggest the right account. */
  accountTypes: AccountType[];
  /** True when the (lowercased, trimmed) header row is this institution's export. */
  matches(headers: string[]): boolean;
  parseRow(row: CsvRow): ParseResult;
}

export interface RowProblem {
  /** 1-based line in the file, counting the header */
  rowNumber: number;
  problem: string;
}

export type ParsedFile =
  | {
      status: "ok";
      adapterId: string;
      institution: string;
      accountTypes: AccountType[];
      transactions: NormalizedTransaction[];
      problems: RowProblem[];
      /** original names of columns that were discarded */
      sensitiveHeaders: string[];
      /** the account's balance on the last date in the file, when the export shows one */
      latestBalance: { date: string; balance: number } | null;
    }
  | { status: "unreadable"; message: string };
