import Link from "next/link";
import { PageHeader } from "@/components/page";
import r from "@/components/record.module.css";
import { requireOsUser } from "@/lib/auth";
import { LOOP_STEPS } from "@/lib/hubs-loop";
import s from "./start.module.css";

export const metadata = { title: "Start here" };

// Phase 24: how the OS works, in the order the work happens. Each step says what the OS does by itself, what only a person
// decides, and where to click. Worked examples follow real paths through the screens.
const STEPS: Record<string, { auto: string; you: string; where: [string, string][] }> = {
  find: { auto: "Every few hours it pulls funding calls, World Bank projects, signals and scan results, matches funding to projects and ranks everything in the Opportunity queue.", you: "Read the queue, open what looks worth it, dismiss the rest.", where: [["Opportunity queue", "/origination"], ["Funding calls", "/funding"], ["Scans", "/scans"]] },
  qualify: { auto: "Screens each project for integrity (exclusions, protected areas, community, sanctions, evidence) and scores readiness by sector.", you: "Decide whether to pursue. Only an owner can override an integrity block, with a written reason.", where: [["Integrity screening", "/origination?tab=screening"], ["Projects", "/projects"]] },
  reach: { auto: "Finds organizations and decision makers and drafts outreach in Regenera's style.", you: "Approve every message before it is sent. Handle replies.", where: [["Outreach drafts to approve", "/queue"], ["Organizations", "/companies"], ["Find decision makers", "/prospecting"]] },
  win: { auto: "Drafts the diagnostic proposal (service, scope, price band) and keeps the sales pipeline current.", you: "Price, send and sign. Contingent or success fees need counsel.", where: [["Sales pipeline", "/deals"], ["Contracts", "/contracts"]] },
  deliver: { auto: "Creates tasks, back-plans application dates and drafts documents.", you: "Do and review the work; approve and submit applications.", where: [["Tasks", "/tasks"], ["Applications", "/funding?tab=bids"], ["Documents", "/documents"]] },
  capital: { auto: "Matches cleared projects to capital partners on stated criteria and blocks introductions for excluded projects.", you: "Request and make introductions; agree structures.", where: [["Capital needs", "/capital?tab=opportunities"], ["Capital partners", "/capital"], ["Introductions", "/capital?tab=introductions"]] },
  steward: { auto: "Turns overdue obligations into tasks and keeps impact records by kind (baseline to verified).", you: "Record evidence and commission independent verification.", where: [["Stewardship & impact", "/origination?tab=stewardship"], ["Reports", "/reports"]] },
};

const EXAMPLES: { title: string; steps: [string, string | null][] }[] = [
  { title: "A funding call fits one of our projects", steps: [
    ["Command → Daily brief names the match, or open the Opportunity queue and filter From a funding call", "/origination?entrance=capital_first"],
    ["Open the project: its Capital tab shows the integrity decision, readiness and the funding match with its open questions", null],
    ["Answer the eligibility questions with the funder; mark the match eligible or not with the basis", null],
    ["Draft diagnostic proposal (Capital tab): creates a draft engagement, a proposal and an approval task. Nothing is sent", null],
    ["Approve and send from Approvals; the deal moves to Proposal in the sales pipeline", "/approvals"],
  ] },
  { title: "An enquiry arrives from regenera.bio", steps: [
    ["It lands as a New lead (Command → Incoming)", "/deals?stage=lead"],
    ["Open the lead: book a call or close it as not a fit; the strip on the deal shows the next step", null],
    ["Link or create the project it concerns, so it is screened and scored", "/projects?new=1"],
    ["Propose the diagnostic, agree terms in Contracts, then the engagement starts in Deliver", "/contracts"],
  ] },
  { title: "Introduce a cleared project to capital", steps: [
    ["Qualify: the project must be Eligible or Conditionally eligible (Integrity screening)", "/origination?tab=screening"],
    ["Capital needs: record the need per purpose and instrument on the project's Capital tab", "/capital?tab=opportunities"],
    ["Capital partners: impact criteria and status show the fit with each screened project (owner only)", "/capital"],
    ["Request the introduction: blocked automatically if the integrity decision is excluded or human review", "/capital?tab=introductions"],
  ] },
];

const WORDS: [string, string][] = [
  ["Opportunity (queue item)", "Something the OS found that might become work for Regenera: a project, a funding match, a thesis or a client need."],
  ["Project", "A physical asset or development (a solar plant, a restoration site). Has a stage, integrity decision, readiness and capital needs."],
  ["Deal / sales pipeline", "Regenera's own potential fee. Never project value or capital raised."],
  ["Funding call", "A grant, tender or programme with a deadline (public or blended finance)."],
  ["Capital need", "What a project must raise, per purpose and instrument (pre-development, equity, senior debt…)."],
  ["Mandate", "A signed or scoped client objective with written criteria (not the workspace)."],
  ["Integrity decision", "Whether we may pursue a project under the current policy; kept per version, never rewritten."],
];

export default async function StartPage() {
  await requireOsUser("/start");
  return (
    <>
      <PageHeader title="Start here" actions={<Link className="btn btn--primary" href="/today">Go to Command</Link>} />
      <p className={s.lede}>Regenera earns fees by finding regenerative projects that need help, proving they are sound, and getting them to capital. The OS runs that loop with you, in seven steps. The sidebar follows the same order.</p>
      <ol className={s.loop}>
        {LOOP_STEPS.map((step, i) => {
          const d = STEPS[step.key];
          return (
            <li key={step.key} className={s.step}>
              <h2><span>{i + 1}</span> {step.label}</h2>
              <p className={s.q}>{step.question}</p>
              <p><b>The OS does:</b> {d.auto}</p>
              <p><b>You decide:</b> {d.you}</p>
              <p className={s.links}>{d.where.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}<Link href={`/overview/${step.key}`}>Step overview →</Link></p>
            </li>
          );
        })}
      </ol>
      <section className={r.panel}>
        <p className={r.panelTitle}>A good daily routine (15 minutes)</p>
        <ol className={s.routine}>
          <li><Link href="/today">Command</Link>: clear <b>Needs your decision</b> and read the daily brief.</li>
          <li><Link href="/approvals">Approvals</Link>: approve or reject drafts, introductions and proposals.</li>
          <li><Link href="/origination">Opportunity queue</Link>: review the top five; qualify or dismiss.</li>
          <li><Link href="/inbox">Inbox</Link>: handle replies; book calls.</li>
        </ol>
      </section>
      <h2 className={s.h2}>Worked examples</h2>
      <div className={s.examples}>
        {EXAMPLES.map(ex => (
          <section key={ex.title} className={r.panel}>
            <p className={r.panelTitle}>{ex.title}</p>
            <ol className={s.routine}>{ex.steps.map(([t, href], i) => <li key={i}>{href ? <Link href={href}>{t}</Link> : t}</li>)}</ol>
          </section>
        ))}
      </div>
      <h2 className={s.h2}>Words the OS uses</h2>
      <dl className={s.words}>{WORDS.map(([w, d]) => <div key={w}><dt>{w}</dt><dd>{d}</dd></div>)}</dl>
    </>
  );
}
