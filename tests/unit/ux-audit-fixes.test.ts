// UX audit fixes (2026-10-10): destructive confirmation, input preservation keys, project next step.
import { describe, expect, it } from "vitest";
import { formKey, isDestructiveLabel, isRestorable, snapshotUsable } from "@/lib/form-guard";
import { nextStep, type NextStepInput } from "@/lib/projects/next-step";

describe("form guard helpers", () => {
  it("asks for a second click only on destructive labels", () => {
    for (const l of ["Delete", " Remove ", "Revoke access", "delete list"]) expect(isDestructiveLabel(l)).toBe(true);
    for (const l of ["Save", "Removed", "Undo delete", "Record decision", "Qualify"]) expect(isDestructiveLabel(l)).toBe(false);
  });
  it("restores typed fields, never hidden ids, passwords or files", () => {
    expect(["text", "textarea", "select-one", "date", "number", "checkbox"].every(isRestorable)).toBe(true);
    expect(["hidden", "password", "file", "submit"].some(isRestorable)).toBe(false);
  });
  it("identifies a form by page, position and hidden values", () => {
    expect(formKey("/capital?tab=introductions", 2, [["back", "/x"], ["id", "a"]])).toBe("/capital?tab=introductions#2|back=/x&id=a");
    expect(formKey("/a", 0, [])).not.toBe(formKey("/a", 1, []));
  });
  it("offers a saved submission back only on the same page within two minutes", () => {
    const s = { key: "k", page: "/deals/1", at: 1_000, fields: [{ name: "note", type: "text", value: "x" }] };
    expect(snapshotUsable(s, "/deals/1", 60_000)).toBe(true);
    expect(snapshotUsable(s, "/deals/2", 60_000)).toBe(false);
    expect(snapshotUsable(s, "/deals/1", 200_000)).toBe(false);
    expect(snapshotUsable({ ...s, fields: [] }, "/deals/1", 2_000)).toBe(false);
    expect(snapshotUsable(null, "/deals/1", 2_000)).toBe(false);
  });
});

describe("project next step", () => {
  const base: NextStepInput = { id: "p1", stage: "opportunity", integrity: "eligible", highConstraints: 0, blockedReadiness: [], openFundingMatches: 0, sponsorContact: true, deals: [], capitalNeeds: 0 };
  it("puts what blocks progress first", () => {
    expect(nextStep({ ...base, integrity: null }).href).toBe("/projects/p1?tab=capital#integrity");
    expect(nextStep({ ...base, integrity: "excluded", highConstraints: 3 }).title).toMatch(/owner must decide/);
    expect(nextStep({ ...base, integrity: "redesign_required" }).title).toMatch(/redesign/);
    expect(nextStep({ ...base, highConstraints: 2, blockedReadiness: ["Land control"] }).href).toBe("/projects/p1?tab=constraints");
    expect(nextStep({ ...base, blockedReadiness: ["Land control"] }).title).toBe("Unblock readiness: Land control");
    expect(nextStep({ ...base, openFundingMatches: 1 }).href).toBe("/projects/p1?tab=capital#funding-matches");
    expect(nextStep({ ...base, sponsorContact: false }).href).toBe("/projects/p1?tab=stakeholders");
  });
  it("then moves the commercial and capital work", () => {
    expect(nextStep(base).action).toBe("Draft the proposal");
    expect(nextStep({ ...base, deals: [{ id: "d1", stage: "proposal" }] }).href).toBe("/deals/d1");
    expect(nextStep({ ...base, stage: "development", deals: [{ id: "d1", stage: "signed" }] }).title).toMatch(/must raise/);
    expect(nextStep({ ...base, stage: "operations", deals: [{ id: "d1", stage: "active" }], capitalNeeds: 2 }).title).toMatch(/stewardship/);
  });
  it("never blocks an eligible project with nothing outstanding", () => {
    expect(nextStep({ ...base, integrity: "conditionally_eligible", deals: [{ id: "d1", stage: "signed" }], capitalNeeds: 1 }).href).toBe("/projects/p1?tab=readiness");
  });
});
