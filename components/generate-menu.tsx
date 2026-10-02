// Generate menu (extended specification §11): opens the document generator on a record with the template chosen, where
// the draft is previewed with its sources and missing items before anything is created. Nothing is sent or published.
import Link from "next/link";
import ui from "./ui.module.css";

const MENUS = {
  organization: [["account-brief", "Account brief"], ["meeting-brief", "Meeting brief"]],
  deal: [["proposal", "Proposal"], ["bid-no-bid", "Bid / no-bid memo"], ["meeting-brief", "Meeting brief"]],
  objective: [["opportunity-shortlist", "Opportunity / partner shortlist"], ["capital-matching-brief", "Capital matching brief"]],
  project: [["project-brief", "Project readiness brief"], ["site-intelligence-report", "Site intelligence report"], ["capital-pathway-report", "Capital pathway report"]],
} as const;

export function GenerateMenu({ entity, id }: { entity: keyof typeof MENUS; id: string }) {
  return (
    <details style={{ position: "relative" }}>
      <summary className="btn" style={{ listStyle: "none" }}>Generate</summary>
      <div role="menu" style={{ position: "absolute", right: 0, zIndex: 20, marginTop: 4, minWidth: 240, background: "var(--paper)", border: "1px solid var(--line)", borderRadius: 6, padding: 6, boxShadow: "var(--shadow-overlay)" }}>
        {MENUS[entity].map(([key, label]) => (
          <Link key={key} role="menuitem" href={`/documents/generator?template=${key}&entity=${id}`} className={ui.sub} style={{ display: "block", padding: "6px 8px", fontSize: 13, color: "var(--text)" }}>{label}</Link>
        ))}
        <p className={ui.sub} style={{ margin: "4px 8px 2px" }}>Shows sources and missing items first; creates a draft only.</p>
      </div>
    </details>
  );
}
