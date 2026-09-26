import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  brokerProfiles, capitalRequirements, events, jobs, mandates, notificationMutes, notifications, playbookRuns, playbooks, playbookVersions, portalUsers, projectParties,
  projectReadiness, projects, referralRegistrations, stageGates, tasks, triggerRules,
} from "@/db/schema";
import { checkStageGate, dispatchEvents, emitEvent, ensureRulesAndGates, matches, openNotifications } from "@/lib/events/engine";
import { registerReferral } from "@/lib/portal/broker";
import { createProject, setReadiness, setStage } from "@/lib/projects/engine";
import { createTestDb } from "../helpers/d1";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); });
afterAll(async () => { await t?.dispose(); });

const M = "mandate_regenera", OTHER = "mandate_other";
const NOW = new Date("2026-09-26T12:00:00Z");

beforeEach(async () => {
  for (const x of [notifications, notificationMutes, events, triggerRules, stageGates, tasks, jobs, playbookRuns, playbookVersions, playbooks, referralRegistrations, brokerProfiles, portalUsers, capitalRequirements, projectParties, projectReadiness, projects, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values([
    { id: M, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } },
    { id: OTHER, slug: "other", name: "Other", type: "advisory", rules: { massAllowed: true, approvalRequired: true } },
  ]);
});

describe("trigger engine", () => {
  it("condition matching: operators and missing fields", () => {
    expect(matches([{ field: "to", op: "eq", value: "construction" }], { to: "construction" })).toBe(true);
    expect(matches([{ field: "size", op: "gte", value: 50 }], { size: 100 })).toBe(true);
    expect(matches([{ field: "kind", op: "in", value: ["capital", "broker"] }], { kind: "project" })).toBe(false);
    expect(matches([{ field: "country", op: "eq", value: "MX" }], {})).toBe(false);
    expect(matches([], {})).toBe(true);
  });

  it("stage change to Capital alignment starts the capital pathway playbook and notifies; each event is processed once", async () => {
    await ensureRulesAndGates(t.db, M);
    const p = await createProject(t.db, { mandateId: M, name: "Valle" }, "alan");
    await setStage(t.db, p.id, "capital_alignment", "alan", "ready");
    const r1 = await dispatchEvents(t.db, NOW);
    expect(r1.events).toBe(2); // PROJECT_CREATED + PROJECT_STAGE_CHANGED
    const [run] = await t.db.select().from(playbookRuns);
    expect(run).toMatchObject({ entityId: p.id, startedBy: expect.stringMatching(/^trigger:/) });
    expect((await openNotifications(t.db, [M], "alan@regenera.bio", NOW)).map(n => n.title)).toEqual(["Valle reached Capital alignment"]);
    expect(await dispatchEvents(t.db, NOW)).toEqual({ events: 0, actions: 0 });
    expect(await openNotifications(t.db, [OTHER], "x@y.z", NOW)).toEqual([]);
  });

  it("introducer registration with conflicts raises a critical notification and a review task; mutes apply to addressed notifications", async () => {
    await ensureRulesAndGates(t.db, M);
    const [u] = await t.db.insert(portalUsers).values({ mandateId: M, email: "b@b.com", kind: "broker", status: "active" }).returning();
    const [b] = await t.db.insert(brokerProfiles).values({ mandateId: M, portalUserId: u.id, complianceStatus: "applied" }).returning();
    await registerReferral(t.db, b.id, { targetType: "company", name: "Acme" }, NOW);
    await dispatchEvents(t.db, NOW);
    const ns = await openNotifications(t.db, [M], "alan@regenera.bio", NOW);
    expect(ns.map(n => n.priority)).toEqual(["critical", "action"]);
    expect((await t.db.select().from(tasks)).map(x => x.title)).toEqual(["Review introducer registration: Acme"]);
    await t.db.insert(notificationMutes).values({ email: "alan@regenera.bio", category: "system" });
    await t.db.insert(triggerRules).values({ mandateId: M, name: "Addressed", eventType: "SIGNAL_CREATED", actions: [{ type: "notify", priority: "information", category: "system", title: "x", to: "alan@regenera.bio" }] });
    await emitEvent(t.db, { mandateId: M, type: "SIGNAL_CREATED", actor: "system" });
    await dispatchEvents(t.db, NOW);
    expect((await t.db.select().from(triggerRules).where(eq(triggerRules.name, "Addressed")))[0].lastResult).toBe("muted");
  });
});

describe("stage gates", () => {
  it("block entry to Capital alignment until readiness, a capital requirement and a confirmed sponsor exist", async () => {
    await ensureRulesAndGates(t.db, M);
    const p = await createProject(t.db, { mandateId: M, name: "G" }, "alan");
    let g = await checkStageGate(t.db, p.id, "capital_alignment");
    expect(g).toMatchObject({ gated: true, enforce: "block", passed: false });
    expect(g.results.filter(x => !x.pass)).toHaveLength(3);
    for (const d of ["land", "grid", "permitting", "technical", "commercial", "financial", "legal", "environmental"] as const) await setReadiness(t.db, p.id, d, { status: "in_progress", evidence: "e" }, "alan");
    await t.db.insert(capitalRequirements).values({ projectId: p.id, mandateId: M, purpose: "Dev", instrument: "development_capital" });
    await t.db.insert(projectParties).values({ projectId: p.id, mandateId: M, role: "sponsor", confirmed: "confirmed" });
    g = await checkStageGate(t.db, p.id, "capital_alignment");
    expect(g.passed).toBe(true);
    expect((await checkStageGate(t.db, p.id, "diagnostic")).gated).toBe(false);
  });
});
