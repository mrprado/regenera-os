// Drive export: reuses the app folder, creates it once, uploads multipart metadata + bytes into it, and reports failures
// with the reconnect hint instead of pretending success. No network: fetch is mocked.
import { describe, expect, it } from "vitest";
import { ensureFolder, multipartBody, uploadToDrive } from "@/lib/google/drive";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Google Drive export", () => {
  it("reuses the app folder when it exists and creates it otherwise", async () => {
    const calls: string[] = [];
    const found = (async (url: string) => { calls.push(url); return json({ files: [{ id: "F1", name: "Regenera OS" }] }); }) as unknown as typeof fetch;
    expect(await ensureFolder("t", undefined, found)).toBe("F1");
    expect(calls).toHaveLength(1);
    let n = 0;
    const create = (async (_u: string, init?: RequestInit) => { n++; return n === 1 ? json({ files: [] }) : (expect(init?.method).toBe("POST"), json({ id: "F2" })); }) as unknown as typeof fetch;
    expect(await ensureFolder("t", undefined, create)).toBe("F2");
  });
  it("uploads metadata with the parent folder and the file bytes", async () => {
    let body: Uint8Array | null = null, ctype = "";
    const f = (async (url: string, init?: RequestInit) => {
      if (url.includes("/upload/")) { body = init!.body as Uint8Array; ctype = String((init!.headers as Record<string, string>)["content-type"]); return json({ id: "D1", webViewLink: "https://drive.google.com/file/d/D1" }); }
      return json({ files: [{ id: "F1" }] });
    }) as unknown as typeof fetch;
    const r = await uploadToDrive("t", { name: "Brief-v1.pdf", mimeType: "application/pdf", bytes: new Uint8Array([37, 80, 68, 70]) }, f);
    expect(r.id).toBe("D1");
    expect(ctype).toMatch(/^multipart\/related; boundary=/);
    const text = new TextDecoder().decode(body!);
    expect(text).toContain('"parents":["F1"]');
    expect(text).toContain("%PDF");
  });
  it("fails honestly with a reconnect hint on an expired grant", async () => {
    const f = (async () => json({ error: "invalid" }, 401)) as unknown as typeof fetch;
    await expect(ensureFolder("t", undefined, f)).rejects.toThrow(/Reconnect Google/);
  });
  it("builds a well-formed multipart body", () => {
    const t = new TextDecoder().decode(multipartBody({ name: "a" }, new Uint8Array([65]), "text/plain", "B"));
    expect(t.startsWith("--B\r\n")).toBe(true);
    expect(t.endsWith("\r\n--B--")).toBe(true);
  });
});
