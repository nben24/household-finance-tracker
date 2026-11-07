// Describes the *shape* of bank CSV files without printing their contents:
// layout, date formats, how amounts are signed, and how rows would be typed.
// Use it to check an export before importing, or to share safe details.
//
//   npm run inspect:csv                     every .csv in ./statements
//   npm run inspect:csv -- path/to/file.csv
//
// No merchant names, descriptions, amounts or dates are printed.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { classifyTransaction } from "@/lib/import/classify";
import { parseCsv } from "@/lib/import/csv";
import { parseRows } from "@/lib/import/parse-file";
import { parseXlsx } from "@/lib/import/xlsx";
import { detectAdapter } from "@/lib/import/registry";

// Placeholder ids; only the names matter for recognizing Zelle between you.
const MEMBERS = [
  { id: "john", name: "John" },
  { id: "jane", name: "Jane" },
];

function filesToInspect(): string[] {
  const args = process.argv.slice(2);
  if (args.length > 0) return args;
  const folder = "statements";
  try {
    return readdirSync(folder)
      .filter((name) => /\.(csv|xlsx)$/i.test(name))
      .map((name) => join(folder, name));
  } catch {
    console.error("No files given and no ./statements folder. Put CSVs in ./statements (it is git-ignored).");
    process.exit(1);
  }
}

/** "09/27/2026" → "99/99/9999"; "($25.00)" → "($99.99)"; letters become "x" */
function shape(value: string): string {
  return value.trim().replace(/[A-Za-z]+/g, "x").replace(/\d/g, "9").slice(0, 20) || "(empty)";
}

function tally(values: string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => `${value} ×${count}`)
    .join(", ");
}

for (const path of filesToInspect()) {
  console.log(`\n=== ${path.split("/").pop()} (${Math.round(statSync(path).size / 1024)} KB)`);
  const isSpreadsheet = /\.xlsx$/i.test(path);
  const rows = isSpreadsheet ? parseXlsx(new Uint8Array(readFileSync(path))) : parseCsv(readFileSync(path, "utf8"));
  const headerIndex = rows.slice(0, 25).findIndex((cells) => detectAdapter(cells));
  const result = parseRows(rows);

  if (result.status !== "ok") {
    console.log(`Not importable: ${result.message}`);
    // Only the first row (normally the column names) is printed as text.
    if (rows[0]) console.log(`First row: ${rows[0].map((cell) => (/\d/.test(cell) ? "<value>" : cell.trim())).join(" | ")}`);
    for (const cells of rows.slice(1, 4)) console.log(`  next row shape: ${cells.map(shape).join(" | ")}`);
    continue;
  }

  const header = rows[headerIndex].map((cell) => cell.trim());
  const dataRows = rows.slice(headerIndex + 1);
  const column = (name: string) => header.findIndex((cell) => cell.toLowerCase() === name);
  const amountColumn = column("amount");
  const typeColumn = column("transaction type") >= 0 ? column("transaction type") : column("type");
  const dateColumn = [column("transaction date"), column("posting date"), column("posted date"), column("date")].find(
    (index) => index >= 0,
  );

  console.log(`Detected: ${result.institution} (${result.adapterId}), header is row ${headerIndex + 1} (blank lines not counted)`);
  console.log(`Columns: ${header.filter(Boolean).join(" | ")}`);
  if (result.sensitiveHeaders.length) console.log(`Sensitive columns dropped: ${result.sensitiveHeaders.join(", ")}`);
  console.log(`Rows: ${dataRows.length} · read as transactions: ${result.transactions.length} · problems: ${result.problems.length}`);
  for (const problem of result.problems.slice(0, 10)) console.log(`  line ${problem.rowNumber}: ${problem.problem}`);
  if (dateColumn !== undefined) console.log(`Date formats: ${tally(dataRows.map((cells) => shape(cells[dateColumn] ?? "")))}`);
  if (amountColumn >= 0) console.log(`Amount formats: ${tally(dataRows.map((cells) => shape(cells[amountColumn] ?? "")))}`);
  if (typeColumn >= 0 && amountColumn >= 0) {
    console.log("Raw sign of the amount, by the file's type column:");
    const byType = new Map<string, string[]>();
    for (const cells of dataRows) {
      const type = (cells[typeColumn] ?? "").trim() || "(blank)";
      const raw = (cells[amountColumn] ?? "").trim();
      const sign = raw === "" ? "empty" : /^[-(−]/.test(raw) ? "negative" : "positive";
      byType.set(type, [...(byType.get(type) ?? []), sign]);
    }
    for (const [type, signs] of byType) console.log(`  ${type}: ${tally(signs)}`);
  }
  const moneyOut = result.transactions.filter((t) => t.amount < 0).length;
  console.log(`After conversion: ${moneyOut} money out, ${result.transactions.length - moneyOut} money in`);
  for (const accountType of result.accountTypes) {
    const types = result.transactions.map(
      (t) => classifyTransaction(t, accountType, { ownerId: "john", members: MEMBERS }).type,
    );
    console.log(`If imported into a ${accountType.replace("_", " ")} account: ${tally(types)}`);
    const reasons = result.transactions.map((t) => {
      const c = classifyTransaction(t, accountType, { ownerId: "john", members: MEMBERS });
      return `${t.amount < 0 ? "out" : "in"} → ${c.type} (${c.reason} · ${c.confidence} confidence)`;
    });
    console.log(`    why: ${tally(reasons).split(", ").join("\n         ")}`);
  }
}
console.log("\nNothing above contains merchants, descriptions, amounts or dates.");
