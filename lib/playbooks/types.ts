// Playbook definition shape (master build instruction §22). Stored as JSON per version; checks are evaluated by
// lib/playbooks/checks.ts against real records, never by an AI's say-so.

export type Governance = "autonomous" | "review" | "approval";

export type CheckSpec =
  | { type: "field_present"; field: string }                                   // on the run's entity row
  | { type: "count_at_least"; source: string; min: number; where?: Record<string, string | string[]> }
  | { type: "readiness_known"; min: number }                                  // project readiness dimensions not Unknown
  | { type: "party_role"; role: string; confirmed?: boolean }
  | { type: "none_open"; source: string; where?: Record<string, string | string[]> }
  | { type: "manual" };                                                        // a person confirms

export type PlaybookDefinition = {
  purpose: string;
  whenToUse: string;
  trigger: string;
  inputs: string[];
  steps: { key: string; title: string; detail?: string; tool?: string; governance: Governance }[];
  rules: { id: string; text: string; origin?: string }[];            // decision rules and edge cases
  toolbox: { kind: "api" | "tool" | "template" | "reference" | "example" | "subplaybook"; name: string; ref?: string }[];
  proof: { id: string; text: string; check: CheckSpec }[];            // definition of done
  evidence: string[];                                                  // what must be attached or cited
  governance: { autonomous: string[]; review: string[]; approval: string[]; restricted: string[] };
};
