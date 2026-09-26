import { describe, expect, it } from "vitest";
import { neighbourhood, warmPaths, type Graph } from "@/lib/graph/graph";

const g: Graph = {
  nodes: new Map([["regenera", { label: "Regenera", kind: "regenera" }], ["p:ana", { label: "Ana", kind: "person" }], ["p:bo", { label: "Bo", kind: "person" }], ["o:fund", { label: "Green Fund", kind: "organization" }], ["p:cy", { label: "Cy", kind: "person" }]] as never),
  edges: [
    { a: "regenera", b: "p:ana", type: "knows", strength: 0.9, why: "12 meetings" },
    { a: "p:ana", b: "o:fund", type: "works_at", strength: 0.6, why: "Works at" },
    { a: "regenera", b: "p:bo", type: "knows", strength: 0.2, why: "One email" },
    { a: "p:bo", b: "o:fund", type: "advises", strength: 0.9, why: "Advisor" },
    { a: "p:cy", b: "o:fund", type: "works_at", strength: 0.6, why: "Works at" },
  ],
};

describe("warm paths", () => {
  it("prefers the strongest route and explains every hop", () => {
    const paths = warmPaths(g, "o:fund", 3);
    expect(paths[0].nodes).toEqual(["regenera", "p:ana", "o:fund"]);
    expect(paths[0].hops.map(h => h.why)).toEqual(["12 meetings", "Works at"]);
    expect(paths[0].warmth).toBeCloseTo(0.54, 2);
    expect(paths[1].nodes).toEqual(["regenera", "p:bo", "o:fund"]);
    expect(warmPaths(g, "p:cy")[0].nodes).toEqual(["regenera", "p:ana", "o:fund", "p:cy"]);
    expect(warmPaths(g, "p:nobody")).toEqual([]);
  });

  it("neighbourhood stays within depth", () => {
    const n = neighbourhood(g, "p:ana", 1);
    expect(n.nodes.sort()).toEqual(["o:fund", "p:ana", "regenera"]);
  });
});
