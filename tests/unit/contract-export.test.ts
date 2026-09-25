import { unzipSync, strFromU8 } from "fflate";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { templateLibrary, templatePdf, templatesZip } from "@/lib/contracts/export";
import { contractPdf, parseContract } from "@/lib/contracts/pdf";

describe("contract PDFs", () => {
  it("offers 15 blank templates with unique keys, PDF names and named blanks", () => {
    const files = templateLibrary();
    expect(files).toHaveLength(15);
    expect(new Set(files.map(f => f.key)).size).toBe(15);
    for (const f of files) {
      expect(f.body, f.key).not.toMatch(/\{\{\w+\}\}/);
      expect(f.fileName, f.key).toMatch(/^Regenera-[\w-]+\.pdf$/);
      expect(f.fileName, f.key).not.toContain("--");
    }
    const capital = files.find(f => f.key === "engagement_letter-capital_advisory")!;
    expect(capital.body).toContain("[COUNSEL REVIEW REQUIRED]");
    expect(files.find(f => f.key === "engagement_letter-diagnostic")!.body).not.toContain("[COUNSEL REVIEW REQUIRED]");
  });

  it("parses the contract Markdown into title, sections, lists, notes and paragraphs with bold runs", () => {
    const blocks = parseContract("> Note\n\n# Title\n\n**Date:** today\nLine two\n\n## 1. Scope\n- one\n- two");
    expect(blocks.map(b => b.kind)).toEqual(["note", "title", "p", "h2", "li", "li"]);
    expect(blocks[2].lines[0]).toEqual([{ text: "Date:", bold: true }, { text: " today", bold: false }]);
    expect(blocks[2].lines).toHaveLength(2);
  });

  it("renders a multi-page A4 PDF with metadata, and survives characters the standard fonts lack", async () => {
    const f = templateLibrary().find(t => t.key === "engagement_letter-capital_advisory")!;
    const doc = await PDFDocument.load(await templatePdf(f, "2026-09-24"));
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(doc.getTitle()).toBe(f.name);
    expect(doc.getAuthor()).toBe("Regenera");
    expect(Math.round(doc.getPage(0).getWidth())).toBe(595);
    const odd = await contractPdf("# Título → 中文 ✓\n\nDíaz — “quotes” and €100", { kicker: "Draft", shortTitle: "Odd", status: "Draft", date: "2026-09-24" });
    expect((await PDFDocument.load(odd)).getPageCount()).toBe(1);
  });

  it("zips every template PDF plus a README", async () => {
    const entries = unzipSync(await templatesZip("2026-09-24"));
    expect(Object.keys(entries)).toHaveLength(16);
    expect(strFromU8(entries["README.txt"])).toContain("not legal advice");
    expect(strFromU8(entries[templateLibrary()[0].fileName].slice(0, 5))).toBe("%PDF-");
  });
});
