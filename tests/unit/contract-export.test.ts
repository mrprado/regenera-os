import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { markdownToHtml, templateLibrary, templatesZip, wordDoc } from "@/lib/contracts/export";

describe("contract downloads", () => {
  it("offers 15 blank templates with unique keys and named blanks", () => {
    const files = templateLibrary();
    expect(files).toHaveLength(15);
    expect(new Set(files.map(f => f.key)).size).toBe(15);
    expect(new Set(files.map(f => f.fileName)).size).toBe(15);
    for (const f of files) {
      expect(f.body, f.key).not.toMatch(/\{\{\w+\}\}/);
      expect(f.fileName, f.key).toMatch(/^Regenera-[\w-]+\.doc$/);
    }
    const capital = files.find(f => f.key === "engagement_letter-capital_advisory")!;
    expect(capital.body).toContain("[COUNSEL REVIEW REQUIRED]");
    expect(capital.body).toContain("[CLIENT NAME]");
    expect(files.find(f => f.key === "engagement_letter-diagnostic")!.body).not.toContain("[COUNSEL REVIEW REQUIRED]");
  });

  it("escapes text before formatting, so contract text cannot inject markup", () => {
    const html = markdownToHtml('# Title\n**Bold** <script>alert(1)</script> & "x"\n- item <b>');
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<b>Bold</b> &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;");
    expect(html).toContain("<li>item &lt;b&gt;</li>");
    expect(wordDoc("A <b>", "x")).toContain("<title>A &lt;b&gt;</title>");
  });

  it("zips every template plus a README", () => {
    const entries = unzipSync(templatesZip());
    expect(Object.keys(entries)).toHaveLength(16);
    expect(strFromU8(entries["README.txt"])).toContain("not legal advice");
    expect(strFromU8(entries[templateLibrary()[0].fileName])).toContain("urn:schemas-microsoft-com:office:word");
  });
});
