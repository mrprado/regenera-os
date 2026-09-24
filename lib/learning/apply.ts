// Applying an approved learning-loop proposal. Called only from confirmProposal (owner, pending, once).
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { segments, sequences } from "@/db/schema";
import { setState } from "@/lib/state";

export async function applyLearningChange(db: Db, mandateId: string, _actor: string, kind: string, change: { action: string; args: Record<string, unknown> }): Promise<Record<string, unknown>> {
  const a = change.args;
  const now = new Date().toISOString();
  switch (change.action) {
    case "segment_angle": {
      const after = String(a.after).slice(0, 500);
      await db.update(segments).set({ angle: after, updatedAt: now }).where(eq(segments.id, String(a.segmentId)));
      return { segmentId: a.segmentId, before: a.before, after };
    }
    case "sequence_timing": {
      const [seq] = await db.select().from(sequences).where(eq(sequences.id, String(a.sequenceId)));
      if (!seq || seq.mandateId !== mandateId) throw new Error("Sequence not found in this mandate");
      const days = a.after as number[];
      if (days.length !== seq.steps.length) throw new Error("The step count changed since this was proposed");
      const steps = seq.steps.map((s, i) => ({ ...s, day: days[i] }));
      await db.update(sequences).set({ steps, updatedAt: now }).where(eq(sequences.id, seq.id));
      return { sequenceId: seq.id, before: a.before, after: days };
    }
    case "scoring_weights": {
      await setState(db, "scoring_weights", JSON.stringify(a.after));
      return { before: a.before, after: a.after };
    }
    case "acknowledge":
      return { kind, acknowledged: true };
    default:
      throw new Error(`Unknown learning change ${change.action}`);
  }
}
