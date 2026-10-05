import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = new URL("./", import.meta.url).pathname;
const previewDir = "/private/tmp/mandarin-overlap-previews";
const projectDir = "/Users/milindc/gitrepos/Kaizen";
const ankiDb = "/Users/milindc/Library/Application Support/Anki2/User 1/collection.anki2";
const deckName = "中文::Mandarin Top-1500 Frequency";
const fontFamily = "Arial";

function parseEnv(text) {
  const result = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals < 1) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function normalizeWord(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .normalize("NFKC")
    .trim();
}

const envFile = await fs.readFile(`${projectDir}/.env`, "utf8");
const localEnv = parseEnv(envFile);
if (!localEnv.DATABASE_URL) throw new Error("DATABASE_URL is missing from .env");

const blueprintSql = `
SELECT COALESCE(json_agg(json_build_object(
  'level', source.level,
  'position', source.position,
  'word', source.word
) ORDER BY source.level, source.position), '[]'::json)::text
FROM (
  SELECT level, entry.position::int AS position, entry.word
  FROM "MandarinBlueprintLevel"
  CROSS JOIN LATERAL jsonb_array_elements_text(words) WITH ORDINALITY AS entry(word, position)
  WHERE level <= 36
) AS source;
`;

const blueprintRows = JSON.parse(execFileSync(
  "/opt/homebrew/bin/psql",
  [localEnv.DATABASE_URL, "-At", "-c", blueprintSql],
  { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
).trim() || "[]");

const deckSql = `
SELECT COALESCE(json_group_array(json_object(
  'noteId', ordered.note_id,
  'word', ordered.word
)), '[]')
FROM (
  SELECT n.id AS note_id,
         CASE
           WHEN instr(n.flds, char(31)) > 0 THEN substr(n.flds, 1, instr(n.flds, char(31)) - 1)
           ELSE n.flds
         END AS word
  FROM notes n
  JOIN cards c ON c.nid = n.id
  JOIN decks d ON d.id = c.did
  WHERE replace(d.name, char(31), '::') = '${deckName}'
  GROUP BY n.id
  ORDER BY n.id
) AS ordered;
`;

const ankiRows = JSON.parse(execFileSync(
  "/usr/bin/sqlite3",
  ["-readonly", ankiDb, deckSql],
  { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
).trim() || "[]");

const blueprintMap = new Map();
for (const row of blueprintRows) {
  const word = normalizeWord(row.word);
  if (!word) continue;
  if (!blueprintMap.has(word)) {
    blueprintMap.set(word, {
      word,
      firstLevel: Number(row.level),
      levelPosition: Number(row.position),
      blueprintOrder: blueprintMap.size + 1,
    });
  }
}

const ankiMap = new Map();
for (const row of ankiRows) {
  const word = normalizeWord(row.word);
  if (!word) continue;
  if (!ankiMap.has(word)) {
    ankiMap.set(word, {
      word,
      noteId: Number(row.noteId),
      deckOrder: ankiMap.size + 1,
    });
  }
}

const blueprint = [...blueprintMap.values()];
const anki = [...ankiMap.values()];
const intersection = blueprint
  .filter((row) => ankiMap.has(row.word))
  .map((row) => ({ ...row, deckOrder: ankiMap.get(row.word).deckOrder }));
const collator = new Intl.Collator("zh-Hans");
const combined = [...new Set([...blueprintMap.keys(), ...ankiMap.keys()])]
  .sort((a, b) => collator.compare(a, b))
  .map((word) => ({
    word,
    blueprint: blueprintMap.get(word) ?? null,
    anki: ankiMap.get(word) ?? null,
  }));

const workbook = Workbook.create();
const summary = workbook.worksheets.add("Summary");
const intersectionSheet = workbook.worksheets.add("Intersection");
const combinedSheet = workbook.worksheets.add("Combined unique");
const blueprintSheet = workbook.worksheets.add("Blueprint 1-36");
const ankiSheet = workbook.worksheets.add("Anki Top-1500");

for (const sheet of [summary, intersectionSheet, combinedSheet, blueprintSheet, ankiSheet]) {
  sheet.showGridLines = false;
}
summary.tabColor = "#1F4E78";
intersectionSheet.tabColor = "#4472C4";

summary.getRange("A2:F2").merge();
summary.getRange("A2").values = [["Mandarin vocabulary overlap through Blueprint level 36"]];
summary.getRange("A4:B4").values = [["Metric", "Result"]];
summary.getRange("A5:A12").values = [
  ["Blueprint unique words (levels 1-36)"],
  ["Anki cards/notes in selected deck"],
  ["Anki unique words"],
  ["Intersection (unique exact matches)"],
  ["Blueprint coverage by Anki deck"],
  ["Anki deck coverage by Blueprint"],
  ["Combined unique words (union)"],
  ["Anki deck shortfall from its 1,500 label"],
];
summary.getRange("B5").formulas = [[`=COUNTA('Blueprint 1-36'!$B$2:$B$${blueprint.length + 1})`]];
summary.getRange("B6").values = [[ankiRows.length]];
summary.getRange("B7:B8").formulas = [
  [`=COUNTA('Anki Top-1500'!$B$2:$B$${anki.length + 1})`],
  [`=COUNTA(Intersection!$A$2:$A$${intersection.length + 1})`],
];
summary.getRange("B9:B12").formulas = [
  ["=B8/B5"],
  ["=B8/B7"],
  ["=B5+B7-B8"],
  ["=1500-B6"],
];
summary.getRange("D4:F4").values = [["Method", "Detail", "Value"]];
summary.getRange("D5:F9").values = [
  ["Blueprint scope", "Levels", "1-36"],
  ["Blueprint source", "Stored level word arrays", "Kaizen local database"],
  ["Anki source", "Exact deck", deckName],
  ["Match rule", "Text normalization", "NFKC + trim + markup/zero-width removal"],
  ["Comparison", "Set operation", "Exact unique-word intersection"],
];
summary.getRange("A14:F16").values = [
  ["Notes", null, null, null, null, null],
  ["The Anki deck currently contains 1,497 cards/notes, so the comparison uses the deck as it exists rather than assuming three missing entries.", null, null, null, null, null],
  ["No Simplified/Traditional conversion or semantic equivalence was applied. A match requires the normalized written form to be identical.", null, null, null, null, null],
];
summary.getRange("A14:F14").merge();
summary.getRange("A15:F15").merge();
summary.getRange("A16:F16").merge();

intersectionSheet.getRange("A1:D1").values = [["Word", "Blueprint order", "First level", "Anki deck order"]];
intersectionSheet.getRange("A2").write(intersection.map((row) => [row.word, row.blueprintOrder, row.firstLevel, row.deckOrder]));

combinedSheet.getRange("A1:F1").values = [["Word", "In Blueprint 1-36", "In Anki deck", "First level", "Blueprint order", "Anki deck order"]];
combinedSheet.getRange("A2").write(combined.map((row) => [
  row.word,
  row.blueprint ? "Yes" : "No",
  row.anki ? "Yes" : "No",
  row.blueprint?.firstLevel ?? null,
  row.blueprint?.blueprintOrder ?? null,
  row.anki?.deckOrder ?? null,
]));

blueprintSheet.getRange("A1:E1").values = [["Blueprint order", "Word", "First level", "Level position", "In Anki deck"]];
blueprintSheet.getRange("A2").write(blueprint.map((row) => [
  row.blueprintOrder,
  row.word,
  row.firstLevel,
  row.levelPosition,
  ankiMap.has(row.word) ? "Yes" : "No",
]));

ankiSheet.getRange("A1:D1").values = [["Deck order", "Word", "In Blueprint 1-36", "First Blueprint level"]];
ankiSheet.getRange("A2").write(anki.map((row) => [
  row.deckOrder,
  row.word,
  blueprintMap.has(row.word) ? "Yes" : "No",
  blueprintMap.get(row.word)?.firstLevel ?? null,
]));

const headerFill = "#1F4E78";
const lightBlue = "#D9EAF7";
const paleGreen = "#E2F0D9";
const paleAmber = "#FFF2CC";
const borderColor = "#D9E2F3";

summary.getRange("A2:F16").format.font = { name: fontFamily, size: 10, color: "#1F1F1F" };
summary.getRange("A2:F2").format = {
  font: { name: fontFamily, size: 16, bold: true, color: "#1F1F1F" },
  verticalAlignment: "center",
};
summary.getRange("A4:B4").format = { fill: headerFill, font: { name: fontFamily, bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center" };
summary.getRange("D4:F4").format = { fill: headerFill, font: { name: fontFamily, bold: true, color: "#FFFFFF" }, horizontalAlignment: "center", verticalAlignment: "center" };
summary.getRange("A5:A12").format.fill = lightBlue;
summary.getRange("B5:B12").format = { fill: "#F7FBFF", font: { name: fontFamily, bold: true, color: "#1F1F1F" }, horizontalAlignment: "right" };
summary.getRange("B5:B8").format.numberFormat = "#,##0";
summary.getRange("B9:B10").format.numberFormat = "0.0%";
summary.getRange("B11:B12").format.numberFormat = "#,##0";
summary.getRange("D5:E9").format.fill = "#F2F6FA";
summary.getRange("F5:F9").format.fill = "#FFFFFF";
summary.getRange("A14:F14").format = { fill: "#EAF2F8", font: { name: fontFamily, bold: true, color: "#1F1F1F" } };
summary.getRange("A15:F16").format = { font: { name: fontFamily, italic: true, color: "#555555" }, wrapText: true, verticalAlignment: "top" };
summary.getRange("A4:B12").format.borders = { preset: "outside", style: "thin", color: borderColor };
summary.getRange("D4:F9").format.borders = { preset: "outside", style: "thin", color: borderColor };
summary.getRange("A14:F16").format.borders = { preset: "outside", style: "thin", color: borderColor };
summary.getRange("A1:A16").format.columnWidthPx = 290;
summary.getRange("B1:B16").format.columnWidthPx = 110;
summary.getRange("C1:C16").format.columnWidthPx = 24;
summary.getRange("D1:D16").format.columnWidthPx = 110;
summary.getRange("E1:E16").format.columnWidthPx = 170;
summary.getRange("F1:F16").format.columnWidthPx = 330;
summary.getRange("A2:F2").format.rowHeightPx = 32;
summary.getRange("A15:F16").format.rowHeightPx = 34;

function styleDataSheet(sheet, usedRange, headerRange, widths, highlightColumn = null) {
  sheet.getRange(usedRange).format.font = { name: fontFamily, size: 10, color: "#1F1F1F" };
  sheet.getRange(headerRange).format = {
    fill: headerFill,
    font: { name: fontFamily, bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { insideVertical: { style: "thin", color: "#FFFFFF" }, bottom: { style: "thin", color: "#FFFFFF" } },
  };
  widths.forEach((width, index) => {
    sheet.getRangeByIndexes(0, index, Number(usedRange.match(/\d+$/)[0]), 1).format.columnWidthPx = width;
  });
  if (highlightColumn) sheet.getRange(highlightColumn).format.fill = paleGreen;
  sheet.freezePanes.freezeRows(1);
}

styleDataSheet(intersectionSheet, `A1:D${intersection.length + 1}`, "A1:D1", [100, 125, 95, 120]);
styleDataSheet(combinedSheet, `A1:F${combined.length + 1}`, "A1:F1", [100, 135, 120, 95, 120, 120]);
styleDataSheet(blueprintSheet, `A1:E${blueprint.length + 1}`, "A1:E1", [125, 100, 95, 100, 110], `E2:E${blueprint.length + 1}`);
styleDataSheet(ankiSheet, `A1:D${anki.length + 1}`, "A1:D1", [105, 100, 145, 140], `C2:C${anki.length + 1}`);
combinedSheet.getRange(`B2:C${combined.length + 1}`).format.fill = "#F2F6FA";
intersectionSheet.getRange(`A2:A${intersection.length + 1}`).format.fill = paleGreen;

for (const [sheet, lastCol, lastRow] of [
  [intersectionSheet, "D", intersection.length + 1],
  [combinedSheet, "F", combined.length + 1],
  [blueprintSheet, "E", blueprint.length + 1],
  [ankiSheet, "D", anki.length + 1],
]) {
  sheet.getRange(`A1:${lastCol}${lastRow}`).format.verticalAlignment = "center";
}

workbook.recalculate();

const summaryCheck = await workbook.inspect({ kind: "table", range: "Summary!A2:F16", include: "values,formulas", tableMaxRows: 20, tableMaxCols: 8 });
console.log(summaryCheck.ndjson);
const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);

await fs.mkdir(previewDir, { recursive: true });
for (const [sheetName, range] of [
  ["Summary", "A1:F16"],
  ["Intersection", "A1:D30"],
  ["Combined unique", "A1:F30"],
  ["Blueprint 1-36", "A1:E30"],
  ["Anki Top-1500", "A1:D30"],
]) {
  const preview = await workbook.render({ sheetName, range, scale: 1.2, format: "png" });
  const safeName = sheetName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  await fs.writeFile(`${previewDir}/${safeName}.png`, new Uint8Array(await preview.arrayBuffer()));
}

const output = await SpreadsheetFile.exportXlsx(workbook);
const outputPath = `${outputDir}mandarin-blueprint-level-36-vs-anki-top-1500.xlsx`;
await output.save(outputPath);

console.log(JSON.stringify({
  outputPath,
  blueprintRows: blueprintRows.length,
  blueprintUnique: blueprint.length,
  ankiRows: ankiRows.length,
  ankiUnique: anki.length,
  intersection: intersection.length,
  union: combined.length,
  blueprintCoverage: intersection.length / blueprint.length,
  ankiCoverage: intersection.length / anki.length,
}, null, 2));
