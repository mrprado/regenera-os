import { describe, expect, it } from "vitest";
import { canonicalLinkedin, normalizeEmail, normalizeOrgName, registrableDomain } from "@/lib/dedupe/normalize";

describe("normalizeOrgName", () => {
  it("drops legal suffixes, accents and punctuation", () => {
    expect(normalizeOrgName("Energía Renovable del Sur, S.A. de C.V.")).toBe("energia renovable del sur");
    expect(normalizeOrgName("Brookfield Asset Management Ltd.")).toBe("brookfield asset management");
    expect(normalizeOrgName("The Nature Conservancy")).toBe("nature conservancy");
    expect(normalizeOrgName("Natural Capital Fund III-A, L.P.")).toBe("natural capital fund iii a");
    expect(normalizeOrgName("Siemens AG")).toBe("siemens");
    expect(normalizeOrgName("Smith & Sons Holdings Group")).toBe("smith and sons");
  });

  it("never returns an empty name", () => {
    expect(normalizeOrgName("Holding")).toBe("holding");
  });
});

describe("registrableDomain", () => {
  it("handles URLs, hosts and emails", () => {
    expect(registrableDomain("https://www.bam.brookfield.com/about")).toBe("brookfield.com");
    expect(registrableDomain("jane@mail.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain("WWW.Regenera.bio")).toBe("regenera.bio");
    expect(registrableDomain("energia.gob.mx")).toBe("energia.gob.mx");
  });

  it("ignores free-mail providers and junk", () => {
    expect(registrableDomain("someone@gmail.com")).toBeNull();
    expect(registrableDomain("localhost")).toBeNull();
    expect(registrableDomain("")).toBeNull();
  });
});

describe("canonicalLinkedin and normalizeEmail", () => {
  it("canonicalizes LinkedIn URL variants", () => {
    const a = canonicalLinkedin("https://mx.linkedin.com/in/Jane-Doe-123/?originalSubdomain=mx");
    expect(a).toBe("https://www.linkedin.com/in/jane-doe-123");
    expect(canonicalLinkedin("linkedin.com/in/jane-doe-123")).toBe(a);
    expect(canonicalLinkedin("https://example.com/jane")).toBeNull();
  });

  it("normalizes email", () => {
    expect(normalizeEmail(" Jane.Doe@Example.COM ")).toBe("jane.doe@example.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
  });
});
