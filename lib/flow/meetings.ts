// Meeting-to-action (extended specification §13): reviewed notes become PROPOSED changes (tasks, next action,
// qualification evidence, coverage roles) in the proposals table. Nothing applies until a person confirms each one on
// the record or on Command; nothing is sent. Every proposal quotes the line of the notes it came from.
// Deterministic markers always work ("Action:", "Next step:", "Need:", "Budget:", "Timing:", "Decision maker:", "TODO",
// "- [ ]"); when Claude is configured, a structured extraction adds proposals whose quote must appear in the notes.
import type Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import * as z from "zod/v4";
import type { Db } from "@/db";
import { deals, meetingNotes, proposals, type QualificationField } from "@/db/schema";
import { runStructured, type AiConfig } from "@/lib/ai/run";

export type ProposedChange = { title: string; action: "create_task" | "next_action" | "qualification_field" | "coverage_role"; args: Record<string, unknown>; quote: string };

const DATE = /\b(\d{4}-\d{2}-\d{2})\b/;
const MARKERS: { re: RegExp; field?: QualificationField }[] = [
  { re: /^(?:[-*]\s*)?(?:need|problem)\s*:\s*(.+)$/i, field: "need" },
  { re: /^(?:[-*]\s*)?(?:budget|funding)\s*:\s*(.+)$/i, field: "budgetPath" },
  { re: /^(?:[-*]\s*)?(?:timing|timeline|deadline)\s*:\s*(.+)$/i, field: "timing" },
  { re: /^(?:[-*]\s*)?(?:decision maker|buyer|economic buyer)\s*:\s*(.+)$/i, field: "buyer" },
  { re: /^(?:[-*]\s*)?(?:decision process|process)\s*:\s*(.+)$/i, field: "decisionProcess" },
  { re: /^(?:[-*]\s*)?(?:alternatives?|competition|competitors?)\s*:\s*(.+)$/i, field: "alternatives" },
];

/** Pure: proposals from explicit markers in the notes. */
export function extractMarked(notes: string, ctx: { dealId: string | null; orgId: string | null }): ProposedChange[] {
  const out: ProposedChange[] = [];
  for (const raw of notes.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const act = line.match(/^(?:[-*]\s*)?(?:action|todo|follow[- ]?up)\s*:\s*(.+)$/i) ?? line.match(/^[-*]\s*\[\s\]\s*(.+)$/);
    if (act) { const due = act[1].match(DATE)?.[1]; out.push({ title: `Task: ${act[1]}`, action: "create_task", args: { title: act[1].replace(DATE, "").trim(), due, dealId: ctx.dealId, orgId: ctx.orgId }, quote: line }); continue; }
    const next = line.match(/^(?:[-*]\s*)?(?:next step|agreed next step)\s*:\s*(.+)$/i);
    if (next && ctx.dealId) {
      const due = next[1].match(DATE)?.[1] ?? new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
      out.push({ title: `Next action: ${next[1]}`, action: "next_action", args: { dealId: ctx.dealId, action: next[1].replace(DATE, "").trim(), date: due }, quote: line });
      out.push({ title: `Qualification · agreed next step: ${next[1]}`, action: "qualification_field", args: { dealId: ctx.dealId, field: "agreedNextStep", text: next[1], evidence: `Meeting notes: "${line}"` }, quote: line });
      continue;
    }
    for (const m of MARKERS) {
      const hit = line.match(m.re);
      if (hit && ctx.dealId && m.field) { out.push({ title: `Qualification · ${m.field}: ${hit[1]}`, action: "qualification_field", args: { dealId: ctx.dealId, field: m.field, text: hit[1], evidence: `Meeting notes: "${line}"` }, quote: line }); break; }
    }
  }
  return out;
}

const zExtract = z.object({
  tasks: z.array(z.object({ title: z.string().max(300), due: z.string().max(10).default(""), quote: z.string().max(400) })).max(12),
  qualification: z.array(z.object({ field: z.enum(["need", "decision", "buyer", "decisionProcess", "budgetPath", "timing", "alternatives", "agreedNextStep", "feeBasis"]), text: z.string().max(400), quote: z.string().max(400) })).max(10),
});

/** Claude extraction, kept only where the quoted line is really in the notes (no invented commitments). */
export async function extractWithClaude(db: Db, cfg: AiConfig, notes: string, ctx: { dealId: string | null; orgId: string | null; noteId: string }, client?: Anthropic): Promise<ProposedChange[]> {
  const r = await runStructured(db, cfg, "meeting.actions", notes, zExtract, { entity: "meeting_note", entityId: ctx.noteId }, client);
  const inNotes = (q: string) => q.trim().length > 8 && notes.includes(q.trim());
  return [
    ...r.tasks.filter(t => inNotes(t.quote)).map(t => ({ title: `Task: ${t.title}`, action: "create_task" as const, args: { title: t.title, due: t.due, dealId: ctx.dealId, orgId: ctx.orgId }, quote: t.quote })),
    ...(ctx.dealId ? r.qualification.filter(q => inNotes(q.quote)).map(q => ({ title: `Qualification · ${q.field}: ${q.text}`, action: "qualification_field" as const, args: { dealId: ctx.dealId, field: q.field, text: q.text, evidence: `Meeting notes: "${q.quote}"` }, quote: q.quote })) : []),
  ];
}

export async function saveMeetingNote(db: Db, mandateId: string, input: { orgId: string | null; dealId: string | null; title: string; heldOn: string; participants: string; notes: string }, by: string) {
  if (input.dealId) {
    const [d] = await db.select({ orgId: deals.orgId }).from(deals).where(and(eq(deals.id, input.dealId), eq(deals.mandateId, mandateId)));
    if (!d) throw new Error("Opportunity not found");
    input.orgId = input.orgId ?? d.orgId;
  }
  const [n] = await db.insert(meetingNotes).values({ mandateId, ...input, status: "reviewed", createdBy: by }).returning();
  return n;
}

/** Stores proposals (pending) for a reviewed note; duplicates of the same quote and action are skipped. */
export async function proposeFromNote(db: Db, mandateId: string, noteId: string, changes: ProposedChange[], by: string) {
  const seen = new Set<string>();
  let n = 0;
  for (const c of changes) {
    const k = `${c.action}:${c.quote}:${JSON.stringify(c.args)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    await db.insert(proposals).values({ mandateId, kind: "action", source: "meeting", title: c.title.slice(0, 300), evidence: { noteId, quote: c.quote }, change: { action: c.action, args: c.args }, createdBy: by,
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString() });
    n++;
  }
  return n;
}
