import { UNSUPPORTED_LAYOUTS } from "./adapters";
import { latestBalance } from "@/lib/finance/net-worth";
import { parseCsv } from "./csv";
import { parseXlsx } from "./xlsx";
import { detectAdapter, normalizeHeaders } from "./registry";
import { findSensitiveHeaders, isSensitiveHeader } from "./sensitive";
import type { CsvRow, NormalizedTransaction, ParsedFile, RowProblem } from "./types";

// Some exports (Bank of America) put a summary block above the real header.
const HEADER_SEARCH_ROWS = 25;
export const MAX_ROWS_PER_FILE = 5000;

/** Turns the text of one bank CSV into normalized transactions. Runs in the browser. */
export function parseCsvFile(text: string): ParsedFile {
  return parseRows(parseCsv(text));
}

/** The same for an Excel (.xlsx) export. */
export function parseSpreadsheetFile(bytes: Uint8Array): ParsedFile {
  let rows: string[][];
  try {
    rows = parseXlsx(bytes);
  } catch (error) {
    return {
      status: "unreadable",
      message: error instanceof Error && error.message.startsWith("This spreadsheet")
        ? error.message
        : "We couldn't open this spreadsheet. Try downloading it as CSV instead.",
    };
  }
  return parseRows(rows);
}

/** Rows of cell text (from a CSV or a spreadsheet) → normalized transactions. */
export function parseRows(rows: string[][]): ParsedFile {
  if (rows.length === 0) return { status: "unreadable", message: "This file is empty." };

  for (let index = 0; index < Math.min(rows.length, HEADER_SEARCH_ROWS); index++) {
    const adapter = detectAdapter(rows[index]);
    if (!adapter) continue;

    const originalHeaders = rows[index].map((value) => value.trim());
    const headers = normalizeHeaders(rows[index]);
    const dataRows = rows.slice(index + 1);
    if (dataRows.length > MAX_ROWS_PER_FILE) {
      return {
        status: "unreadable",
        message: `This file has more than ${MAX_ROWS_PER_FILE.toLocaleString("en-US")} rows. Please export a shorter date range.`,
      };
    }

    const transactions: NormalizedTransaction[] = [];
    const problems: RowProblem[] = [];
    dataRows.forEach((cells, dataIndex) => {
      const row: CsvRow = {};
      headers.forEach((header, column) => {
        // sensitive columns are dropped before the adapter ever sees the row
        if (header && !isSensitiveHeader(header)) row[header] = cells[column] ?? "";
      });
      const result = adapter.parseRow(row);
      if (result.kind === "transaction") transactions.push(result.transaction);
      if (result.kind === "problem") {
        problems.push({ rowNumber: index + dataIndex + 2, problem: result.problem });
      }
    });

    return {
      status: "ok",
      adapterId: adapter.id,
      institution: adapter.institution,
      accountTypes: adapter.accountTypes,
      transactions,
      problems,
      sensitiveHeaders: findSensitiveHeaders(originalHeaders),
      latestBalance: latestBalance(
        transactions.map((t) => ({ date: t.postingDate ?? t.transactionDate, balance: t.balance ?? null })),
      ),
    };
  }

  for (const cells of rows.slice(0, HEADER_SEARCH_ROWS)) {
    const unsupported = UNSUPPORTED_LAYOUTS.find((layout) => layout.matches(normalizeHeaders(cells)));
    if (unsupported) return { status: "unreadable", message: unsupported.message };
  }
  return {
    status: "unreadable",
    message: "We don't recognize this file's layout. Make sure it's a download of account activity from a supported bank.",
  };
}
