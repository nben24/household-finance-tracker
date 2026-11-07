// Minimal reader for Excel (.xlsx) exports: returns the first sheet as rows of
// cell text, the same shape the CSV reader produces. Runs in the browser.
//
// An .xlsx file is a zip of XML files. We read only what bank exports use:
// shared and inline strings, numbers, and dates stored as numbers.

import { strFromU8, unzipSync } from "fflate";

const MAX_UNZIPPED_BYTES = 50 * 1024 * 1024;

function decodeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** All text inside <t> elements (a rich-text string has several). */
function textOf(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((match) => decodeXml(match[1])).join("");
}

/** "AB12" → 27 (zero-based column index). */
function columnIndex(reference: string): number {
  const letters = reference.replace(/\d+/g, "");
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

const BUILT_IN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** Which cell styles (by index) display numbers as dates. */
function dateStyles(stylesXml: string | undefined): Set<number> {
  const dates = new Set<number>();
  if (!stylesXml) return dates;
  const customDateFormats = new Set<number>();
  for (const match of stylesXml.matchAll(/<numFmt\s[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    const code = decodeXml(match[2]).replace(/"[^"]*"|\[[^\]]*\]/g, "");
    if (/[dmy]/i.test(code)) customDateFormats.add(Number(match[1]));
  }
  const cellXfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? "";
  [...cellXfs.matchAll(/<xf\s[^>]*?(?:\/>|>)/g)].forEach((match, index) => {
    const id = Number(/numFmtId="(\d+)"/.exec(match[0])?.[1] ?? 0);
    if (BUILT_IN_DATE_FORMATS.has(id) || customDateFormats.has(id)) dates.add(index);
  });
  return dates;
}

/** Excel's day number (days since 1899-12-30) → MM/DD/YYYY. */
function serialToDate(serial: number): string {
  const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${month}/${day}/${date.getUTCFullYear()}`;
}

/** Path of the first sheet in the workbook's own order. */
function firstSheetPath(files: Record<string, Uint8Array>): string | null {
  const workbook = files["xl/workbook.xml"] ? strFromU8(files["xl/workbook.xml"]) : "";
  const relations = files["xl/_rels/workbook.xml.rels"] ? strFromU8(files["xl/_rels/workbook.xml.rels"]) : "";
  const relationId = /<sheet\s[^>]*r:id="([^"]+)"/.exec(workbook)?.[1];
  if (relationId) {
    const target = new RegExp(`<Relationship\\s[^>]*Id="${relationId}"[^>]*Target="([^"]+)"`).exec(relations)?.[1]
      ?? new RegExp(`<Relationship\\s[^>]*Target="([^"]+)"[^>]*Id="${relationId}"`).exec(relations)?.[1];
    if (target) {
      const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
      if (files[path]) return path;
    }
  }
  return Object.keys(files).filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort()[0] ?? null;
}

export function parseXlsx(bytes: Uint8Array): string[][] {
  let total = 0;
  const files = unzipSync(bytes, {
    filter: (file) => {
      total += file.originalSize;
      if (total > MAX_UNZIPPED_BYTES) throw new Error("This spreadsheet is too large.");
      return file.name.startsWith("xl/") && file.name.endsWith(".xml") || file.name.endsWith(".rels");
    },
  });
  const sheetPath = firstSheetPath(files);
  if (!sheetPath) throw new Error("This spreadsheet has no sheets.");

  const sharedStrings = files["xl/sharedStrings.xml"]
    ? [...strFromU8(files["xl/sharedStrings.xml"]).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((match) => textOf(match[1]))
    : [];
  const dates = dateStyles(files["xl/styles.xml"] ? strFromU8(files["xl/styles.xml"]) : undefined);
  const sheet = strFromU8(files[sheetPath]);

  const rows: string[][] = [];
  for (const rowMatch of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cell of rowMatch[1].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cell[1];
      const body = cell[2] ?? "";
      const reference = /\br="([A-Z]+)\d+"/.exec(attributes)?.[1];
      const type = /\bt="(\w+)"/.exec(attributes)?.[1];
      const style = Number(/\bs="(\d+)"/.exec(attributes)?.[1] ?? -1);
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (type === "s") value = sharedStrings[Number(raw)] ?? "";
      else if (type === "inlineStr") value = textOf(body);
      else if (type === "str" || type === "e") value = decodeXml(raw ?? "");
      else if (type === "b") value = raw === "1" ? "TRUE" : "FALSE";
      else if (raw !== undefined) value = dates.has(style) ? serialToDate(Number(raw)) : decodeXml(raw);
      const index = reference ? columnIndex(reference) : row.length;
      while (row.length < index) row.push("");
      row[index] = value;
    }
    if (row.some((value) => value.trim() !== "")) rows.push(row);
  }
  return rows;
}
