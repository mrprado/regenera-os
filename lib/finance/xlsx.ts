// Minimal XLSX writer (Office Open XML via fflate): worksheets of values with inline strings. The model export is
// values with their provenance, not live formulas; the cover sheet says so.
import { strToU8, zipSync } from "fflate";
import { oneWay, stressCases, modelHealth } from "./analysis";
import { calculate, CONVENTIONS } from "./calc";
import type { ModelDefinition } from "./types";

type Cell = string | number | null | undefined;
const esc = (s: string) => s.replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const colName = (i: number) => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

function sheetXml(rows: Cell[][]) {
  const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => {
    const ref = `${colName(ci)}${ri + 1}`;
    if (c === null || c === undefined || c === "") return "";
    if (typeof c === "number" && Number.isFinite(c)) return `<c r="${ref}"><v>${Math.round(c * 1e6) / 1e6}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(String(c))}</t></is></c>`;
  }).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

export function workbook(sheets: { name: string; rows: Cell[][] }[]) {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`),
  };
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s.rows)); });
  return zipSync(files, { level: 6 });
}

export function modelWorkbook(title: string, meta: { version: number; caseType: string; status: string; preparedBy: string | null; approvedBy: string | null }, def: ModelDefinition) {
  const o = calculate(def), h = modelHealth(def, o), t = oneWay(def, 10), st = stressCases(def);
  const prov = (p: { source: string; date: string | null; confidence: string; status: string }) => [p.source, p.date, p.confidence, p.status];
  return workbook([
    { name: "Cover", rows: [[title], ["Version", meta.version], ["Case", meta.caseType], ["Status", meta.status], ["Prepared by", meta.preparedBy], ["Approved by", meta.approvedBy], ["Currency", def.currency], ["Basis", def.basis], ["Health", h.status], ...h.issues.map(i => [i.level.toUpperCase(), i.message]), [], ["Conventions", CONVENTIONS], ["Note", "Values exported from Regenera OS with their provenance; formulas are not included. The OS calculation is the reference."]] },
    { name: "Summary", rows: [["Metric", "Value"], ["Total uses", o.uses.total], ["CAPEX", o.uses.capex], ["Development remaining", o.uses.development], ["IDC", o.uses.idc], ["Fees", o.uses.fees], ["DSRA", o.uses.dsra], ["Debt", o.debt], ["Grants", o.sources.grants], ["Equity", o.sources.equity], ["Debt sized by", o.debtSizedBy], ["Min DSCR", o.minDscr], ["Avg DSCR", o.avgDscr], ["LLCR", o.llcr], ["PLCR", o.plcr], ["Project IRR %", o.projectIrr], ["Equity IRR %", o.equityIrr], ["Project NPV", o.projectNpv], ["Equity NPV", o.equityNpv], ["MOIC", o.moic], ["Payback (years)", o.paybackYears]] },
    { name: "CAPEX", rows: [["Item", "Category", "Quantity", "Unit", "Unit cost", "Contingency %", "Subtotal", "Site source", "Source", "Date", "Confidence", "Status"], ...def.capex.map(l => [l.label, l.category, l.quantity, l.unit, l.unitCost, l.contingencyPct, l.quantity * l.unitCost * (1 + l.contingencyPct / 100), l.fromSite ?? "", ...prov(l)])] },
    { name: "Development", rows: [["Item", "Budget", "Committed", "Spent", "Remaining", "Gate", "Source", "Date", "Confidence", "Status"], ...def.development.map(l => [l.label, l.budget, l.committed, l.spent, Math.max(0, l.budget - l.spent), l.gate ?? "", ...prov(l)])] },
    { name: "Revenue", rows: [["Stream", "Type", "Certainty", "Basis", "Volume", "Share of generation %", "Price", "Escalation %", "Start year", "Term years", "Tail price", "Source", "Date", "Confidence", "Status"], ...def.revenue.map(s => [s.label, s.type, s.certainty, s.basis, s.annualVolume, s.shareOfGeneration, s.price, s.escalationPct, s.startYear, s.termYears, s.tailPrice, ...prov(s)])] },
    { name: "OPEX", rows: [["Item", "Kind", "Amount", "Escalation %", "Source", "Date", "Confidence", "Status"], ...def.opex.map(l => [l.label, l.kind, l.amount, l.escalationPct, ...prov(l)])] },
    { name: "Cash flow", rows: [["Year", "Phase", "Revenue", "Contracted", "Forecast", "Merchant", "Speculative", "Generation MWh", "OPEX", "EBITDA", "Depreciation", "Interest", "Tax", "CFADS", "Debt draw", "Principal", "Debt service", "Closing debt", "DSCR", "DSRA flow", "Distributions", "Locked up", "Equity flow", "Project flow"],
      ...o.periods.map(p => [p.year, p.phase, p.revenue, p.revenueByCertainty.contracted, p.revenueByCertainty.forecast, p.revenueByCertainty.merchant, p.revenueByCertainty.speculative, p.generationMwh, p.opex, p.ebitda, p.depreciation, p.interest, p.tax, p.cfads, p.debtDraw, p.principal, p.debtService, p.debtClosing, p.dscr, p.dsraFlow, p.distributions, p.lockedUp ? "yes" : "", p.equityFlow, p.projectFlow])] },
    { name: "Sensitivity", rows: [["Driver (±10 %)", "Equity IRR low", "Equity IRR high", "Min DSCR low", "Min DSCR high", "Swing (pts)"], ...t.rows.map(r => [r.label, r.low.equityIrr, r.high.equityIrr, r.low.minDscr, r.high.minDscr, r.swing]), [], ["Stress case", "Equity IRR", "Min DSCR", "Debt serviced", "Covenant breach"], ...st.map(s => [s.label, s.equityIrr, s.minDscr, s.debtServiced ? "yes" : "NO", s.covenantBreach ? "yes" : "no"])] },
  ]);
}
