import { describe, expect, it } from "vitest";
import { normalizeSite, parseHead } from "@/lib/map/entity-image";

describe("entity pictures from page heads", () => {
  it("reads Open Graph image, apple-touch icon and site name, resolving relative URLs", () => {
    const html = `<head><title>Acme Solar</title><meta property="og:site_name" content="Acme Solar"><meta content="/img/hero.jpg" property="og:image"><link rel="apple-touch-icon" href="/apple.png"></head>`;
    expect(parseHead(html, "https://acme.example/about")).toEqual({ image: "https://acme.example/img/hero.jpg", logo: "https://acme.example/apple.png", title: "Acme Solar" });
  });
  it("falls back to twitter:image and favicon", () => {
    const r = parseHead(`<meta name="twitter:image" content="https://cdn.example/x.png"><title>X</title>`, "https://x.example/");
    expect(r.image).toBe("https://cdn.example/x.png");
    expect(r.logo).toBe("https://x.example/favicon.ico");
  });
  it("normalizes only http(s) sites", () => {
    expect(normalizeSite("acme.com")).toBe("https://acme.com/");
    expect(normalizeSite("javascript:alert(1)")).toBeNull();
  });
});
