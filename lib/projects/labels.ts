// Shared helpers for the Projects pages (page files may only export their component).
import { PROJECT_STAGES, type ProjectStage } from "./vocab";

/** Lifecycle stages grouped into five board columns. */
export const STAGE_GROUPS: { key: string; label: string; stages: ProjectStage[] }[] = [
  { key: "origination", label: "Origination", stages: ["opportunity", "screening", "diagnostic"] },
  { key: "development", label: "Development", stages: ["readiness", "development", "structuring"] },
  { key: "capital", label: "Capital", stages: ["capital_alignment", "diligence", "financial_close"] },
  { key: "execution", label: "Execution", stages: ["engineering", "procurement", "construction", "commissioning", "cod"] },
  { key: "operations", label: "Operations and beyond", stages: ["operations", "repowering", "exit", "decommissioning"] },
];

export const stageLabel = (s: string) => PROJECT_STAGES[s as ProjectStage] ?? s;

export const compactMoney = (n: number | null | undefined, currency = "USD") => {
  if (n === null || n === undefined) return "—";
  const a = Math.abs(n);
  const v = a >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : a >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n));
  return `${currency} ${v.replace(".0", "")}`;
};
