// Shared labels for the playbook pages (page files may only export their component).
export const RUN_LABEL: Record<string, string> = { running: "Running", needs_review: "Needs review", awaiting_approval: "Awaiting approval", completed: "Completed", failed: "Failed", cancelled: "Cancelled" };
export const GOVERNANCE_LABEL: Record<string, string> = { autonomous: "AI / tool may execute", review: "Human review", approval: "Human approval" };
export const SCOPE_LABEL: Record<string, string> = { one_time: "One-time correction", process_rule: "Process rule", toolbox_update: "Toolbox update", proof_check: "Proof check" };
