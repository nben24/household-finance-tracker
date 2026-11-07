import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseSpreadsheetFile } from "@/lib/import/parse-file";
import { parseXlsx } from "@/lib/import/xlsx";

// Builds a minimal .xlsx in memory. All values are made up.
function workbook(rowsXml: string, sharedStrings: string[] = [], extraStyles = ""): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "xl/workbook.xml": strToU8(
      '<workbook xmlns:r="r"><sheets><sheet name="Activity" sheetId="1" r:id="rId1"/><sheet name="Summary" sheetId="2" r:id="rId2"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<Relationships><Relationship Id="rId2" Target="worksheets/sheet2.xml"/><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    "xl/sharedStrings.xml": strToU8(`<sst>${sharedStrings.map((s) => `<si><t>${s}</t></si>`).join("")}</sst>`),
    "xl/styles.xml": strToU8(
      `<styleSheet><numFmts><numFmt numFmtId="164" formatCode="mm/dd/yyyy"/></numFmts><cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="2"/>${extraStyles}</cellXfs></styleSheet>`,
    ),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData>${rowsXml}</sheetData></worksheet>`),
    "xl/worksheets/sheet2.xml": strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Wrong sheet</t></is></c></row></sheetData></worksheet>'),
  });
}

describe("reading Excel files", () => {
  it("reads the first sheet: shared strings, inline strings, numbers, and dates stored as numbers", () => {
    const bytes = workbook(
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>Fish &amp; Chips</t></is></c></row>' +
        '<row r="2"><c r="A2" s="1"><v>46292</v></c><c r="B2" s="2"><v>12.5</v></c><c r="C2" t="str"><v>x</v></c></row>' +
        '<row r="3"></row>',
      ["Hello"],
    );
    expect(parseXlsx(bytes)).toEqual([
      ["Hello", "", "Fish & Chips"],
      ["09/27/2026", "12.5", "x"],
    ]);
  });

  it("imports an Amex Excel export, skipping the title block with the account number", () => {
    const headers = ["Date", "Description", "Amount", "Extended Details", "Appears On Your Statement As", "Address", "City/State", "Zip Code", "Country", "Reference", "Category"];
    const strings = [
      "Transaction Details", "Prepared for", "TEST PERSON", "Account Number", "XXXX-XXXXX1-00000",
      ...headers,
      "09/27/2026", "BURGER KING #4123", "BURGER KING #4123 ANYTOWN VA", "'320262700000000001'", "Restaurant-Bar & Café",
    ];
    const s = (text: string) => strings.indexOf(text);
    const cell = (ref: string, text: string) => `<c r="${ref}" t="s"><v>${s(text)}</v></c>`;
    const rows =
      `<row r="1">${cell("A1", "Transaction Details")}</row>` +
      `<row r="2">${cell("A2", "Prepared for")}</row>` +
      `<row r="3">${cell("A3", "TEST PERSON")}</row>` +
      `<row r="4">${cell("A4", "Account Number")}</row>` +
      `<row r="5">${cell("A5", "XXXX-XXXXX1-00000")}</row>` +
      `<row r="7">${headers.map((h, i) => cell(`${String.fromCharCode(65 + i)}7`, h)).join("")}</row>` +
      `<row r="8">${cell("A8", "09/27/2026")}${cell("B8", "BURGER KING #4123")}<c r="C8"><v>14.85</v></c>${cell("E8", "BURGER KING #4123 ANYTOWN VA")}${cell("J8", "'320262700000000001'")}${cell("K8", "Restaurant-Bar & Café")}</row>`;
    const result = parseSpreadsheetFile(workbook(rows, strings.map((t) => t.replace(/&/g, "&amp;"))));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.institution).toBe("American Express");
    expect(result.transactions).toEqual([
      {
        transactionDate: "2026-09-27",
        postingDate: null,
        originalDescription: "BURGER KING #4123 ANYTOWN VA",
        amount: -14.85,
        transactionTypeHint: null,
        sourceId: "320262700000000001",
        merchantHint: "BURGER KING #4123",
        bankCategory: "Restaurant-Bar & Café",
        balance: null,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("00000\"");
  });

  it("explains when a file isn't a real spreadsheet", () => {
    const result = parseSpreadsheetFile(strToU8("not a zip file"));
    expect(result).toEqual({ status: "unreadable", message: "We couldn't open this spreadsheet. Try downloading it as CSV instead." });
  });
});
