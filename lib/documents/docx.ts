// DOCX output (master build instruction §28) without a new dependency: a minimal WordprocessingML package zipped with
// fflate (already used). Same Markdown subset as the PDF renderer; Regenera header, confidential footer, optional
// watermark line at the top. Opens in Word, Google Docs and LibreOffice.
import { strToU8, zipSync } from "fflate";
import { parseContract, type PdfMeta } from "@/lib/contracts/pdf";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const run = (text: string, o: { bold?: boolean; size?: number; color?: string; caps?: boolean } = {}) =>
  `<w:r><w:rPr><w:rFonts w:ascii="Helvetica Neue" w:hAnsi="Helvetica Neue" w:cs="Arial"/>${o.bold ? "<w:b/>" : ""}${o.caps ? "<w:caps/>" : ""}${o.color ? `<w:color w:val="${o.color}"/>` : ""}<w:sz w:val="${o.size ?? 20}"/></w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const para = (runs: string, o: { spacingAfter?: number; indent?: number; shade?: boolean; border?: boolean } = {}) =>
  `<w:p><w:pPr><w:spacing w:after="${o.spacingAfter ?? 120}"/>${o.indent ? `<w:ind w:left="${o.indent}" w:hanging="220"/>` : ""}${o.shade ? '<w:shd w:val="clear" w:color="auto" w:fill="F6F1E3"/>' : ""}${o.border ? '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="C9A84D"/></w:pBdr>' : ""}</w:pPr>${runs}</w:p>`;

export function docxFromMarkdown(md: string, meta: PdfMeta): Uint8Array {
  const body: string[] = [];
  if (meta.watermark) body.push(para(run(meta.watermark, { bold: true, size: 22, color: "B0432F" }), { shade: true, spacingAfter: 200 }));
  body.push(para(run(meta.kicker, { size: 16, color: "5F6A5C", caps: true }), { spacingAfter: 60 }));
  for (const b of parseContract(md)) {
    const runsOf = (line: { text: string; bold: boolean }[], size: number, color?: string) => line.map(r => run(r.text, { bold: r.bold, size, color })).join("");
    if (b.kind === "title") body.push(para(runsOf(b.lines[0], 36, "173B2A"), { spacingAfter: 240, border: true }));
    else if (b.kind === "h2") body.push(para(runsOf(b.lines[0].map(r => ({ ...r, bold: true })), 24, "173B2A"), { spacingAfter: 100 }));
    else if (b.kind === "li") body.push(para(run("•  ", { color: "C9A84D" }) + runsOf(b.lines[0], 20), { indent: 440, spacingAfter: 60 }));
    else if (b.kind === "note") body.push(para(b.lines.map(l => runsOf(l, 19)).join(run(" ")), { shade: true }));
    else body.push(para(b.lines.map(l => runsOf(l, 20)).join(run(" "))));
  }
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body.join("")}<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1500" w:right="1200" w:bottom="1300" w:left="1200" w:header="600" w:footer="600" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const header = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${W}>${para(run("REGENERA", { bold: true, size: 20, color: "173B2A" }) + run("   Regenerative Ecosystem Advisory", { size: 14, color: "5F6A5C" }) + run(`      ${meta.shortTitle}`, { size: 14, color: "5F6A5C" }), { border: true })}</w:hdr>`;
  const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${W}>${para(run(`Regenera | regenera.bio | Confidential   |   ${meta.status}   |   ${meta.date}${meta.code ? `   |   ${meta.code}` : ""}`, { size: 14, color: "5F6A5C" }))}</w:ftr>`;
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
    "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`,
    "word/document.xml": document,
    "word/header1.xml": header,
    "word/footer1.xml": footer,
    "docProps/core.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(meta.shortTitle)}</dc:title><dc:creator>Regenera OS</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])), { level: 6 });
}
