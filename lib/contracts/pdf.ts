// Contract PDFs in Regenera's house style: brand mark and wordmark in the header, a title block on page one,
// numbered sections, and a footer with confidentiality, version and page numbers. Pure pdf-lib, so it runs in
// the Worker. Text comes from the contract Markdown subset (# title, ## sections, **bold**, "- " lists, "> " notes).
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";

const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const C = {
  ink: hex("#0d120e"), fern: hex("#173b2a"), mark: hex("#d0c43c"), pollen: hex("#c9a84d"), water: hex("#476b5e"),
  muted: hex("#5f6a5c"), rule: hex("#d8d4c8"), noteBg: hex("#f6f1e3"),
};

// A4, generous margins.
const W = 595.28, H = 841.89, M = 60, TOP = 92, BOTTOM = 76;
const BODY = 10.2, LEAD = 15.2;

type Run = { text: string; bold: boolean };
type Block = { kind: "title" | "h2" | "p" | "li" | "note"; lines: Run[][] };

const runs = (s: string): Run[] => s.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
  .map(p => (p.startsWith("**") && p.endsWith("**") ? { text: p.slice(2, -2), bold: true } : { text: p, bold: false }));

export function parseContract(md: string): Block[] {
  const blocks: Block[] = [];
  let para: Run[][] = [];
  const flush = () => { if (para.length) blocks.push({ kind: "p", lines: para }); para = []; };
  for (const raw of md.replace(/\r\n/g, "\n").split("\n")) {
    const t = raw.trimEnd();
    if (!t.trim()) { flush(); continue; }
    if (t.startsWith("# ")) { flush(); blocks.push({ kind: "title", lines: [runs(t.slice(2))] }); continue; }
    if (t.startsWith("## ")) { flush(); blocks.push({ kind: "h2", lines: [runs(t.slice(3))] }); continue; }
    if (t.startsWith("> ")) { flush(); blocks.push({ kind: "note", lines: [runs(t.slice(2))] }); continue; }
    if (t.startsWith("- ")) { flush(); blocks.push({ kind: "li", lines: [runs(t.slice(2))] }); continue; }
    para.push(runs(t));
  }
  flush();
  return blocks;
}

/** kicker: the document's standing above the title (e.g. "Template for counsel review"); status and date go in the footer. */
export type PdfMeta = { kicker: string; shortTitle: string; status: string; date: string };

export async function contractPdf(md: string, meta: PdfMeta): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(meta.shortTitle);
  doc.setAuthor("Regenera");
  doc.setCreator("Regenera OS");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Standard fonts only encode WinAnsi: replace anything else so a stray character never breaks a download.
  const safe = (s: string, f: PDFFont) => [...s].map(ch => { try { f.encodeText(ch); return ch; } catch { return ch === "→" ? "->" : "?"; } }).join("");

  let page!: PDFPage;
  let y = 0;
  const newPage = () => { page = doc.addPage([W, H]); y = H - TOP; };
  newPage();
  const ensure = (h: number) => { if (y - h < BOTTOM) newPage(); };

  /** Wraps runs into lines that fit the width. Each word keeps its font; one space is drawn between words. */
  const layout = (lineRuns: Run[], size: number, width: number, forceBold = false) => {
    const out: { text: string; font: PDFFont; w: number }[][] = [[]];
    const space = regular.widthOfTextAtSize(" ", size);
    let x = 0;
    for (const r of lineRuns) {
      const font = r.bold || forceBold ? bold : regular;
      for (const word of safe(r.text, font).split(/\s+/)) {
        if (!word) continue;
        const w = font.widthOfTextAtSize(word, size);
        const needed = x > 0 ? space + w : w;
        if (x > 0 && x + needed > width) { out.push([]); x = 0; }
        out[out.length - 1].push({ text: word, font, w });
        x += x > 0 ? space + w : w;
      }
    }
    return out;
  };
  /** Letter-spaced caps (wordmark, kicker), drawn one character at a time. */
  const spaced = (p: PDFPage, text: string, x: number, yy: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>, tracking: number) => {
    for (const ch of safe(text, font)) { p.drawText(ch, { x, y: yy, size, font, color }); x += font.widthOfTextAtSize(ch, size) + tracking; }
  };
  const drawLines = (lines: { text: string; font: PDFFont; w: number }[][], x0: number, size: number, color = C.ink, lead = LEAD) => {
    const space = regular.widthOfTextAtSize(" ", size);
    for (const line of lines) {
      ensure(lead);
      let x = x0;
      for (const [i, word] of line.entries()) {
        if (i) x += space;
        page.drawText(word.text, { x, y: y - size, size, font: word.font, color });
        x += word.w;
      }
      y -= lead;
    }
  };

  /** Signature blocks side by side: party, signature line, name, title, date. Kept together on one page. */
  const signatures = (parties: Block[]) => {
    const colW = (W - 2 * M - 28) / 2;
    const rows = Math.ceil(parties.length / 2);
    for (let r = 0; r < rows; r++) {
      ensure(118);
      const top = y;
      parties.slice(r * 2, r * 2 + 2).forEach((pb, i) => {
        const text = (l: Run[]) => l.map(x => x.text).join("").trim();
        const party = text(pb.lines[0]);
        const field = (label: string) => text(pb.lines.find(l => text(l).startsWith(`${label}:`)) ?? []).slice(label.length + 1).trim();
        const x = M + i * (colW + 28);
        spaced(page, party.toUpperCase(), x, top - 9, 8.2, bold, C.water, 1.2);
        page.drawLine({ start: { x, y: top - 58 }, end: { x: x + colW, y: top - 58 }, thickness: 0.7, color: C.ink });
        page.drawText("Signature", { x, y: top - 69, size: 7.2, font: regular, color: C.muted });
        page.drawText(safe(`Name: ${field("Name")}`, regular), { x, y: top - 86, size: 9.2, font: regular, color: C.ink });
        page.drawText(safe(`Title: ${field("Title")}`, regular), { x, y: top - 100, size: 9.2, font: regular, color: C.ink });
        page.drawText("Date: ______________________", { x, y: top - 114, size: 9.2, font: regular, color: C.ink });
      });
      y = top - 128;
    }
  };

  const blocks = parseContract(md);
  let firstTitle = true;
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    if (b.kind === "h2" && b.lines[0].map(r => r.text).join("").trim() === "Signatures") {
      y -= 8;
      ensure(150);
      drawLines(layout(b.lines[0], 11.2, W - 2 * M, true), M, 11.2, C.fern, 17);
      y -= 8;
      const parties: Block[] = [];
      while (bi + 1 < blocks.length && blocks[bi + 1].kind === "p") parties.push(blocks[++bi]);
      signatures(parties);
      continue;
    }
    if (b.kind === "title") {
      // Title block: kicker, title, gold rule.
      ensure(90);
      if (!firstTitle) y -= 8;
      spaced(page, meta.kicker.toUpperCase(), M, y - 8, 8, bold, C.water, 1.6);
      y -= 22;
      drawLines(layout(b.lines[0], 20, W - 2 * M, true), M, 20, C.fern, 26);
      page.drawRectangle({ x: M, y: y - 4, width: 56, height: 2.5, color: C.pollen });
      y -= 22;
      firstTitle = false;
    } else if (b.kind === "h2") {
      y -= 8;
      ensure(LEAD * 3);
      drawLines(layout(b.lines[0], 11.2, W - 2 * M, true), M, 11.2, C.fern, 17);
      y -= 2;
    } else if (b.kind === "li") {
      const lines = layout(b.lines[0], BODY, W - 2 * M - 16);
      ensure(LEAD);
      page.drawRectangle({ x: M + 3, y: y - BODY + 3, width: 3.2, height: 3.2, color: C.pollen });
      drawLines(lines, M + 16, BODY);
    } else if (b.kind === "note") {
      const lines = layout(b.lines[0], 8.8, W - 2 * M - 24);
      const h = lines.length * 13 + 14;
      ensure(h + 6);
      page.drawRectangle({ x: M, y: y - h, width: W - 2 * M, height: h, color: C.noteBg });
      page.drawRectangle({ x: M, y: y - h, width: 2.5, height: h, color: C.pollen });
      y -= 7;
      drawLines(lines, M + 14, 8.8, C.muted, 13);
      y -= 13;
    } else {
      for (const l of b.lines) drawLines(layout(l, BODY, W - 2 * M), M, BODY);
      y -= 6;
    }
  }

  // Header and footer on every page, once the page count is known.
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    // Brand mark (the site's favicon: fern square, gold center) and wordmark.
    p.drawRectangle({ x: M, y: H - 52, width: 16, height: 16, color: C.fern });
    p.drawRectangle({ x: M + 4, y: H - 48, width: 8, height: 8, color: C.mark });
    spaced(p, "REGENERA", M + 24, H - 48.5, 10.5, bold, C.fern, 2.2);
    const right = safe(meta.shortTitle, regular).slice(0, 70);
    const rw = regular.widthOfTextAtSize(right, 8);
    p.drawText(right, { x: W - M - rw, y: H - 47, size: 8, font: regular, color: C.muted });
    p.drawLine({ start: { x: M, y: H - 62 }, end: { x: W - M, y: H - 62 }, thickness: 0.6, color: C.rule });

    p.drawLine({ start: { x: M, y: 50 }, end: { x: W - M, y: 50 }, thickness: 0.6, color: C.rule });
    p.drawText("Regenera  |  regenera.bio  |  Confidential", { x: M, y: 36, size: 7.5, font: regular, color: C.muted });
    const mid = safe(`${meta.status}  |  ${meta.date}`, regular);
    p.drawText(mid, { x: W / 2 - regular.widthOfTextAtSize(mid, 7.5) / 2, y: 36, size: 7.5, font: regular, color: C.muted });
    const pn = `Page ${i + 1} of ${pages.length}`;
    p.drawText(pn, { x: W - M - regular.widthOfTextAtSize(pn, 7.5), y: 36, size: 7.5, font: regular, color: C.muted });
  });

  return doc.save();
}
