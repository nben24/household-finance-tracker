import { describe, expect, it } from "vitest";
import { buildReport, csvCell, monthlyPeriods, reportToCsv, weeklyPeriods } from "@/lib/finance/report";
import { parseReportOptions, reportQuery } from "@/lib/finance/report-options";
import { viewEntries, type View } from "@/lib/finance/views";

describe("report periods", () => {
  it("lists months oldest first, marking the year when it changes", () => {
    const periods = monthlyPeriods("2027-01", 3);
    expect(periods.map((p) => [p.label, p.from, p.to])).toEqual([
      ["Nov ’26", "2026-11-01", "2026-11-30"],
      ["Dec ’26", "2026-12-01", "2026-12-31"],
      ["Jan", "2027-01-01", "2027-01-31"],
    ]);
  });

  it("lists weeks that follow the week-start setting", () => {
    expect(weeklyPeriods("2026-10-01", 2, "sunday").map((p) => [p.from, p.to])).toEqual([
      ["2026-09-20", "2026-09-26"],
      ["2026-09-27", "2026-10-03"],
    ]);
    expect(weeklyPeriods("2026-10-01", 1, "monday")[0].from).toBe("2026-09-28");
  });
});

describe("building the report", () => {
  const everyone: View = { kind: "everyone" };
  const rows = [
    { transaction_date: "2026-08-03", amount: -100, transaction_type: "expense" as const, person_id: "n", counterparty_id: null, category_id: "food", subcategory_id: "groceries" },
    { transaction_date: "2026-09-03", amount: -50, transaction_type: "expense" as const, person_id: "n", counterparty_id: null, category_id: "food", subcategory_id: "coffee" },
    { transaction_date: "2026-09-04", amount: -900, transaction_type: "expense" as const, person_id: null, counterparty_id: null, category_id: "home", subcategory_id: "mortgage" },
    { transaction_date: "2026-09-05", amount: 3000, transaction_type: "income" as const, person_id: "n", counterparty_id: null, category_id: null, subcategory_id: null },
    { transaction_date: "2026-09-06", amount: -500, transaction_type: "transfer" as const, person_id: "n", counterparty_id: null, category_id: null, subcategory_id: null },
  ];
  const categories = [
    { id: "food", name: "Food" },
    { id: "home", name: "Housing" },
    { id: "groceries", name: "Groceries" },
    { id: "coffee", name: "Coffee" },
    { id: "mortgage", name: "Mortgage" },
  ];
  const periods = monthlyPeriods("2026-09", 2);
  const entries = viewEntries(rows, everyone, { memberCount: 2, mode: "separate" });

  it("puts categories down the side and months across, with totals", () => {
    const report = buildReport(entries, periods, categories, "category", everyone);
    expect(report.rows).toEqual([
      { id: "home", name: "Housing", cells: [0, 90000], total: 90000 },
      { id: "food", name: "Food", cells: [10000, 5000], total: 15000 },
    ]);
    expect(report.spending).toEqual([10000, 95000]);
    expect(report.income).toEqual([0, 300000]);
    expect(report.net).toEqual([-10000, 205000]);
  });

  it("can break categories down further", () => {
    const report = buildReport(entries, periods, categories, "subcategory", everyone);
    expect(report.rows.map((row) => row.name)).toEqual(["Mortgage", "Groceries", "Coffee"]);
  });

  it("exports a spreadsheet with a header, a row per category and the totals", () => {
    const csv = reportToCsv(buildReport(entries, periods, categories, "category", everyone), periods, false);
    expect(csv.split("\r\n")).toEqual([
      "Category,2026-08-01 to 2026-08-31,2026-09-01 to 2026-09-30,Total",
      "Housing,0.00,900.00,900.00",
      "Food,100.00,50.00,150.00",
      "Total spending,100.00,950.00,1050.00",
      "Income,0.00,3000.00,3000.00",
      "Saved & invested,0.00,0.00,0.00",
      "Left over,-100.00,2050.00,1950.00",
      "",
    ]);
  });
});

describe("spreadsheet safety", () => {
  it("neutralizes text that a spreadsheet would run as a formula", () => {
    expect(csvCell("=HYPERLINK(\"http://evil\")")).toBe("\"'=HYPERLINK(\"\"http://evil\"\")\"");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-SUM(A1)")).toBe("'-SUM(A1)");
    expect(csvCell("@cmd")).toBe("'@cmd");
  });

  it("leaves numbers and ordinary text alone, quoting commas", () => {
    expect(csvCell(-12345)).toBe("-123.45");
    expect(csvCell("Food")).toBe("Food");
    expect(csvCell("Gifts, Donations")).toBe('"Gifts, Donations"');
  });
});

describe("report options", () => {
  const members = [{ id: "n" }];

  it("defaults to six months by category for everyone", () => {
    const options = parseReportOptions({}, members, "2026-10-01", "sunday");
    expect(options).toMatchObject({ view: { kind: "everyone" }, period: "month", count: 6, level: "category" });
    expect(options.periods).toHaveLength(6);
    expect(reportQuery(options)).toEqual({ view: undefined, period: undefined, count: 6, detail: undefined });
  });

  it("accepts only the offered choices", () => {
    const options = parseReportOptions(
      { period: "week", count: "999", detail: "subcategory", view: "n" },
      members,
      "2026-10-01",
      "sunday",
    );
    expect(options).toMatchObject({ view: { kind: "person", personId: "n" }, period: "week", count: 8, level: "subcategory" });
  });
});
