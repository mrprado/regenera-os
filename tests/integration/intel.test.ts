import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/db/schema";
import {
  activities, caseRecords, contacts, deals, enrollments, lists, listMembers, mandateMembers, mandates, mcpClients, mcpCodes, mcpTokens, messages, oauthAccounts,
  organizations, playbookDrafts, privacyRequests, proposals, replies, scores, segments, sequences, suppression, systemState, triggers,
} from "@/db/schema";
import { askOs } from "@/lib/ask/agent";
import { confirmProposal } from "@/lib/ask/execute";
import { runTool, type ToolCtx } from "@/lib/ask/tools";
import { ensurePrompts } from "@/lib/ai/run";
import { restoreInto, runBackup, verifyLatestBackup, type BackupStore } from "@/lib/backup";
import { upsertContact, upsertOrganization } from "@/lib/crm/entities";
import { composeManualEmail, type SendPolicy } from "@/lib/crm/send";
import type { UserScope } from "@/lib/db/scoped";
import { angleStats, proposeOutreachChanges, proposeWeights } from "@/lib/learning/loop";
import { ensureInvestmentMandates, narrowScope, removeMember } from "@/lib/mandates";
import { exchangeToken, issueCode, issuePersonalToken, registerClient, sha256b64url, verifyMcpToken } from "@/lib/mcp/oauth";
import { handleMcp } from "@/lib/mcp/server";
import { ensureSequences } from "@/lib/outreach/sequences";
import { erasePerson, exportPerson, hashedSuppressionKey } from "@/lib/privacy";
import { buildPlaybook, draftPlaybookTemplates, playbookSequence } from "@/lib/radar/playbooks";
import { forecast, stagesFromHistory } from "@/lib/reports/forecast";
import { ensureSegments } from "@/lib/segments";
import { createTestDb } from "../helpers/d1";
import { fakeAgent, fakeAnthropic } from "../helpers/fake-anthropic";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); await ensureSegments(t.db); await ensurePrompts(t.db); });
afterAll(async () => { await t?.dispose(); });

const R = "mandate_regenera", RA = "mandate_ra_esg";
const AI = { apiKey: "x", monthlyBudgetUsd: 50 };
const POLICY: SendPolicy = { production: false, allowedDomains: ["test.regenera.bio"], postalAddress: "Test address" };
const scopeOf = (mandateIds: string[], ownerOf = mandateIds): UserScope => ({ kind: "user", userId: "u", email: "alanprado@regenera.bio", mandateIds, ownerOf, memberOf: mandateIds, ownerOfAll: ownerOf });
const ctx = (scope: UserScope, source: "ask" | "mcp" = "ask"): ToolCtx => ({ db: t.db, scope, actor: scope.email, source });

beforeEach(async () => {
  for (const x of [proposals, caseRecords, playbookDrafts, privacyRequests, mcpTokens, mcpCodes, mcpClients, activities, enrollments, messages, replies, scores, listMembers, lists,
    suppression, deals, triggers, sequences, contacts, organizations, oauthAccounts, mandateMembers, systemState, mandates]) await t.db.delete(x);
  await t.db.insert(mandates).values({ id: R, slug: "regenera", name: "Regenera", type: "advisory", rules: { massAllowed: true, approvalRequired: true } });
  await ensureInvestmentMandates(t.db);
  await ensureSequences(t.db, R);
  await t.db.insert(mandateMembers).values([{ mandateId: R, email: "alanprado@regenera.bio", role: "owner" }]);
});

async function person(mandateId: string, name: string, email: string, extra: Partial<{ orgId: string; segmentId: string; country: string }> = {}) {
  return (await upsertContact(t.db, mandateId, { fullName: name, email, emailStatus: "verified_manual", ...extra }, "other", { source: "test" })).row;
}

describe("mandates", () => {
  it("creates RA-ESG and GWCe as investment mandates with no members and keeps their data isolated", async () => {
    const all = await t.db.select().from(mandates);
    expect(all.filter(m => m.type === "investment").map(m => m.name).sort()).toEqual(["GWCe", "RA-ESG"]);
    expect(all.every(m => m.type !== "investment" || (!m.rules.massAllowed && !m.counselConfirmedAt))).toBe(true);
    expect(await t.db.select().from(mandateMembers).where(eq(mandateMembers.mandateId, RA))).toHaveLength(0);
    await person(R, "Regenera Person", "r@test.regenera.bio");
    await person(RA, "Fund Contact", "f@test.regenera.bio");
    const asRegenera = await runTool(ctx(scopeOf([R])), "search_people", {}) as { total: number; people: { name: string }[] };
    const asRa = await runTool(ctx(scopeOf([RA])), "search_people", {}) as { total: number; people: { name: string }[] };
    expect(asRegenera.people.map(p => p.name)).toEqual(["Regenera Person"]);
    expect(asRa.people.map(p => p.name)).toEqual(["Fund Contact"]);
  });

  it("the header switcher only narrows to mandates the user belongs to, and the last Regenera owner cannot be removed", async () => {
    const s = scopeOf([R, RA], [R]);
    expect(narrowScope(s, RA).mandateIds).toEqual([RA]);
    expect(narrowScope(s, RA).ownerOf).toEqual([]);
    expect(narrowScope(s, "mandate_gwce").mandateIds).toEqual([R, RA]);
    expect(await removeMember(t.db, R, "alanprado@regenera.bio")).toBe(false);
  });

  it("investment compose needs counsel confirmation and a prior relationship with evidence", async () => {
    await t.db.insert(oauthAccounts).values({ mailboxRole: "primary", email: "alanprado@regenera.bio", accessTokenEnc: "x", accessTokenExpiresAt: "2099-01-01T00:00:00Z", scopes: "gmail.send" });
    const c = await person(RA, "Known Investor", "inv@test.regenera.bio");
    const base = { contactId: c.id, subject: "Following our call", body: "Good to speak last week. Sharing the note we discussed.", approvedBy: "alan", confirmUnverified: false, policy: POLICY };
    expect(await composeManualEmail(t.db, base)).toEqual({ ok: false, reason: "counsel_not_confirmed" });
    await t.db.update(mandates).set({ counselConfirmedAt: "2026-09-24T00:00:00Z", counselConfirmedBy: "alan" }).where(eq(mandates.id, RA));
    expect(await composeManualEmail(t.db, base)).toEqual({ ok: false, reason: "needs_prior_relationship" });
    expect(await composeManualEmail(t.db, { ...base, priorRelationship: { how: "Co-investor", since: "2023", evidence: "short" } })).toEqual({ ok: false, reason: "needs_prior_relationship" });
    const ok = await composeManualEmail(t.db, { ...base, priorRelationship: { how: "Co-investor on a 2024 deal", since: "2023", evidence: "Met at the March 2026 board meeting, email thread 14 March" } });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect((await t.db.select().from(messages).where(eq(messages.id, ok.messageId)))[0].priorRelationship?.how).toBe("Co-investor on a 2024 deal");
  });
});

describe("Ask the OS tools", () => {
  it("answers from scoped data and never writes without confirmation", async () => {
    const seg = (await t.db.select().from(segments).where(eq(segments.key, "impact_family_offices")))[0];
    const org = (await upsertOrganization(t.db, R, { name: "Andes Family Office", country: "Peru" }, "other", { source: "test" })).row;
    await t.db.insert(triggers).values({ mandateId: R, orgId: org.id, type: "capital", summary: "New allocation", eventDate: "2026-09-01", urgency: 4 });
    const a = await person(R, "Ana Quispe", "ana@test.regenera.bio", { orgId: org.id, segmentId: seg.id, country: "Peru" });
    await person(R, "Ben Other", "ben@test.regenera.bio");
    const found = await runTool(ctx(scopeOf([R])), "search_people", { segment: "impact_family_offices", withCurrentTrigger: true }) as { total: number; people: { id: string }[] };
    expect(found.total).toBe(1);
    expect(found.people[0].id).toBe(a.id);
    const p = await runTool(ctx(scopeOf([R])), "propose_add_to_list", { contactIds: [a.id], listName: "LatAm FO" }) as { proposalId: string; status: string };
    expect(p.status).toBe("pending_confirmation");
    expect(await t.db.select().from(lists)).toHaveLength(0); // nothing changed yet
    expect(await confirmProposal(t.db, scopeOf([RA]), "other", p.proposalId)).toEqual({ ok: false, error: "Proposal not found" });
    expect((await confirmProposal(t.db, scopeOf([R]), "alan", p.proposalId)).ok).toBe(true);
    expect((await confirmProposal(t.db, scopeOf([R]), "alan", p.proposalId)).ok).toBe(false); // only once
    expect(await t.db.select().from(listMembers)).toHaveLength(1);
  });

  it("drafts go to the approval queue, investment mandates are refused, expired proposals do nothing", async () => {
    const c = await person(R, "Cara Draft", "cara@test.regenera.bio");
    const p = await runTool(ctx(scopeOf([R])), "propose_draft_email", { contactId: c.id, subject: "Following up", body: "Sharing the diagnostic outline we discussed. Would Thursday suit?" }) as { proposalId: string };
    const r = await confirmProposal(t.db, scopeOf([R]), "alan", p.proposalId);
    expect(r.ok).toBe(true);
    const [m] = await t.db.select().from(messages).where(eq(messages.contactId, c.id));
    expect(m).toMatchObject({ status: "pending_approval", tier: "targeted" });
    expect(m.scheduledAt).not.toBeNull();
    const inv = await person(RA, "Investor", "i@test.regenera.bio");
    const pi = await runTool(ctx(scopeOf([RA])), "propose_draft_email", { contactId: inv.id, subject: "Hi", body: "Hello" }) as { proposalId: string };
    expect((await confirmProposal(t.db, scopeOf([RA]), "alan", pi.proposalId)).ok).toBe(false);
    const pe = await runTool({ ...ctx(scopeOf([R])), now: new Date("2026-01-01T00:00:00Z") }, "propose_note", { contactId: c.id, text: "old" }) as { proposalId: string };
    expect(await confirmProposal(t.db, scopeOf([R]), "alan", pe.proposalId)).toEqual({ ok: false, error: "This proposal expired. Ask again." });
  });

  it("the agent loop calls tools and returns the answer and its proposals", async () => {
    const c = await person(R, "Dana Loop", "dana@test.regenera.bio");
    const fake = fakeAgent([
      { tools: [{ name: "search_people", input: { query: "dana" } }] },
      { tools: [{ name: "propose_note", input: { contactId: c.id, text: "Met at the forum" } }] },
      { text: "Dana Loop is in the CRM. I proposed a note, waiting for your confirmation." },
    ]);
    const r = await askOs(ctx(scopeOf([R])), AI, "Add a note to Dana", [], undefined, fake.client);
    expect(r.answer).toContain("waiting for your confirmation");
    expect(r.proposals).toHaveLength(1);
    expect(fake.requests[0].tools.map(x => x.name)).toContain("propose_draft_email");
    expect(JSON.stringify(fake.requests[1].messages)).toContain("Dana Loop");
    expect(await t.db.select().from(activities).where(eq(activities.type, "note"))).toHaveLength(0);
  });
});

describe("MCP server", () => {
  it("OAuth: PKCE, single-use codes, refresh rotation and revocation", async () => {
    const client = await registerClient(t.db, { client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] });
    await expect(registerClient(t.db, { client_name: "Bad", redirect_uris: ["http://evil.test/cb"] })).rejects.toThrow();
    const verifier = "v".repeat(50);
    const challenge = await sha256b64url(verifier);
    const code = await issueCode(t.db, { clientId: client.client_id, userEmail: "alanprado@regenera.bio", redirectUri: "https://claude.ai/api/mcp/auth_callback", codeChallenge: challenge });
    const form = (o: Record<string, string>) => new URLSearchParams(o);
    const bad = await exchangeToken(t.db, form({ grant_type: "authorization_code", code, code_verifier: "w".repeat(50), client_id: client.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback" }));
    expect(bad.ok).toBe(false); // the wrong verifier also burns the code
    const code2 = await issueCode(t.db, { clientId: client.client_id, userEmail: "alanprado@regenera.bio", redirectUri: "https://claude.ai/api/mcp/auth_callback", codeChallenge: challenge });
    const ok = await exchangeToken(t.db, form({ grant_type: "authorization_code", code: code2, code_verifier: verifier, client_id: client.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback" }));
    expect(ok.ok).toBe(true);
    const again = await exchangeToken(t.db, form({ grant_type: "authorization_code", code: code2, code_verifier: verifier, client_id: client.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback" }));
    expect(again.ok).toBe(false);
    if (!ok.ok) return;
    expect((await verifyMcpToken(t.db, `Bearer ${ok.body.access_token}`))?.mandateIds).toEqual([R]);
    const refreshed = await exchangeToken(t.db, form({ grant_type: "refresh_token", refresh_token: ok.body.refresh_token, client_id: client.client_id }));
    expect(refreshed.ok).toBe(true);
    expect((await exchangeToken(t.db, form({ grant_type: "refresh_token", refresh_token: ok.body.refresh_token, client_id: client.client_id }))).ok).toBe(false); // rotated
    expect(await verifyMcpToken(t.db, `Bearer ${ok.body.refresh_token}`)).toBeNull(); // refresh tokens are not access tokens
  });

  it("speaks MCP over the web-standard transport with the same scoping", async () => {
    await person(R, "Eve Mcp", "eve@test.regenera.bio");
    await person(RA, "Hidden Investor", "hidden@test.regenera.bio");
    const token = await issuePersonalToken(t.db, "alanprado@regenera.bio", "test");
    const call = async (body: unknown, auth = `Bearer ${token}`) => handleMcp(t.db, new Request("https://os.regenera.bio/api/mcp", {
      method: "POST", headers: { authorization: auth, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body),
    }), "https://os.regenera.bio");
    const unauth = await call({ jsonrpc: "2.0", id: 1, method: "tools/list" }, "Bearer nope");
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get("www-authenticate")).toContain("oauth-protected-resource");
    const init = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    expect(init.status).toBe(200);
    expect(((await init.json()) as { result: { serverInfo: { name: string } } }).result.serverInfo.name).toBe("regenera-os");
    const list = (await (await call({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json()) as { result: { tools: { name: string; annotations?: { destructiveHint?: boolean } }[] } };
    const names = list.result.tools.map(x => x.name);
    expect(names).toEqual(expect.arrayContaining(["search_people", "propose_enroll", "confirm_proposal"]));
    expect(list.result.tools.find(x => x.name === "confirm_proposal")?.annotations?.destructiveHint).toBe(true);
    const res = (await (await call({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "search_people", arguments: {} } })).json()) as { result: { content: { text: string }[] } };
    const people = JSON.parse(res.result.content[0].text) as { people: { name: string }[] };
    expect(people.people.map(p => p.name)).toEqual(["Eve Mcp"]); // RA-ESG stays invisible: not a member
  });
});

describe("learning loop", () => {
  it("proposes nothing below 50 sends, and an angle change above it that applies on approval", async () => {
    const seg = (await t.db.select().from(segments).where(eq(segments.key, "energy_utilities")))[0];
    const fake = fakeAnthropic([{ proposals: [{ kind: "angle", segment_key: "energy_utilities", title: "Lead with grid risk", rationale: "The grid angle replies at 12% versus 3%.", new_angle: "Grid access decides the project. Subject: your interconnection date.", step_days: [] }] }]);
    expect(await proposeOutreachChanges(t.db, AI, R, new Date(), fake.client)).toBe(0);
    for (let i = 0; i < 52; i++) {
      const c = await person(R, `P${i}`, `p${i}@test.regenera.bio`, { segmentId: seg.id });
      await t.db.insert(messages).values({ mandateId: R, contactId: c.id, channel: "email", toEmail: c.emailLower!, subject: "s", body: "b", status: "sent", sentAt: new Date().toISOString(), angleTag: i % 2 ? "grid" : "land" });
      if (i % 2 && i < 14) await t.db.insert(replies).values({ mandateId: R, contactId: c.id, gmailMessageId: `g${i}`, fromEmail: c.emailLower!, receivedAt: new Date().toISOString(), classification: "interested" });
    }
    const stats = await angleStats(t.db, R);
    expect(stats.find(s => s.angle === "grid")).toMatchObject({ sent: 26, replied: 7 });
    // 26 per angle is still under 50: no model call.
    expect(await proposeOutreachChanges(t.db, AI, R, new Date(), fake.client)).toBe(0);
    await t.db.update(messages).set({ angleTag: "grid" }).where(eq(messages.angleTag, "land"));
    expect(await proposeOutreachChanges(t.db, AI, R, new Date(), fake.client)).toBe(1);
    const [p] = await t.db.select().from(proposals).where(eq(proposals.kind, "angle"));
    expect((await confirmProposal(t.db, scopeOf([R], []), "member", p.id)).ok).toBe(false); // owners only
    expect((await confirmProposal(t.db, scopeOf([R]), "alan", p.id)).ok).toBe(true);
    expect((await t.db.select().from(segments).where(eq(segments.id, seg.id)))[0].angle).toContain("Grid access decides");
  });

  it("proposes scoring weights only with 20+ closed deals", async () => {
    expect(await proposeWeights(t.db, R)).toBeNull();
    for (let i = 0; i < 24; i++) {
      const won = i < 12;
      const c = await person(R, `W${i}`, `w${i}@test.regenera.bio`);
      await t.db.insert(scores).values({ mandateId: R, contactId: c.id, fit: won ? 60 : 55, trigger: won ? 85 : 30, access: 40, total: 60, tier: "targeted", rationale: { fit: "", trigger: "", access: "" }, modelVersion: "test" });
      await t.db.insert(deals).values({ mandateId: R, contactId: c.id, name: `D${i}`, path: "project_diagnostic", stage: won ? "signed" : "lost" });
    }
    const p = await proposeWeights(t.db, R);
    expect(p).not.toBeNull();
    const after = (p!.change.args as { after: { fit: number; trigger: number; access: number } }).after;
    expect(after.trigger).toBeGreaterThan(0.35);
    expect(Math.round((after.fit + after.trigger + after.access) * 100)).toBe(100);
  });
});

describe("forecast", () => {
  it("reads stage history, calibrates with 10+ closed deals, and buckets by month", async () => {
    expect([...stagesFromHistory(["Lead → Engaged", "Engaged → Proposal (confirmed from Ask the OS)", "Created at Engaged: reply"], "lost")].sort()).toEqual(["engaged", "lead", "lost", "proposal"]);
    for (let i = 0; i < 10; i++) {
      const [d] = await t.db.insert(deals).values({ mandateId: R, name: `C${i}`, path: "project_diagnostic", stage: i < 3 ? "signed" : "lost" }).returning();
      await t.db.insert(activities).values({ mandateId: R, dealId: d.id, type: "stage_change", detail: "Lead → Proposal", source: "manual" });
    }
    await t.db.insert(deals).values([
      { mandateId: R, name: "Open A", path: "project_diagnostic", stage: "proposal", valueEstimate: 100_000, expectedClose: "2026-10-15", practice: "development_strategy" },
      { mandateId: R, name: "Retainer", path: "capital_mandate", stage: "engaged", monthlyValue: 10_000, probability: 50, expectedClose: "2026-11-01" },
      { mandateId: R, name: "No date", path: "project_diagnostic", stage: "lead", valueEstimate: 20_000 },
    ]);
    const f = await forecast(t.db, [R], new Date("2026-09-24T00:00:00Z"));
    expect(f.probabilities.proposal).toEqual({ p: 30, source: "calibrated", n: 10 });
    expect(f.probabilities.call_booked.source).toBe("default");
    expect(f.months.map(m => m.month)).toEqual(["2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(f.months[1].weighted).toBe(30_000);
    expect(f.months[2].weighted).toBe(5_000);
    expect(f.months[5].weighted).toBe(5_000);
    expect(f.noDate.deals).toBe(4); // the 3 signed deals without a close date, plus "No date"
  });
});

describe("backup and privacy", () => {
  it("exports every table and restores into an empty database with identical counts", async () => {
    await person(R, "Backup Person", "b@test.regenera.bio");
    const files = new Map<string, string>();
    const store: BackupStore = {
      put: async (k, v) => { files.set(k, v); }, get: async k => files.get(k) ?? null,
      list: async p => [...files.keys()].filter(k => k.startsWith(p)), delete: async ks => { ks.forEach(k => files.delete(k)); },
    };
    files.set("backups/2026-08-01/manifest.json", "{}");
    const m = await runBackup(t.db, store, new Date("2026-09-24T02:30:00Z"));
    expect(m.tables.contacts).toBe(1);
    expect(m.tables.mandates).toBe(3);
    expect(files.has("backups/2026-08-01/manifest.json")).toBe(false); // older than 30 days
    expect((await verifyLatestBackup(t.db, store)).ok).toBe(true);
    const fresh = await createTestDb();
    try {
      const day = "backups/2026-09-24/";
      const body = Object.fromEntries(Object.keys(m.tables).map(n => [n, files.get(`${day}${n}.jsonl`)!]));
      await fresh.d1.prepare("PRAGMA defer_foreign_keys = ON").run();
      const counts = await restoreInto(async (s, p) => { await fresh.d1.prepare(s).bind(...p).run(); }, body);
      expect(counts).toEqual(m.tables);
      const [{ n }] = await fresh.db.all<{ n: number }>(sql`select count(*) as n from contacts`);
      expect(n).toBe(1);
    } finally { await fresh.dispose(); }
    files.set("backups/2026-09-24/contacts.jsonl", "{broken");
    expect((await verifyLatestBackup(t.db, store)).ok).toBe(false);
    void schema;
  });

  it("exports a person, and erasure leaves only a hashed suppression that blocks re-import", async () => {
    const c = await person(R, "Erin Erase", "erin@test.regenera.bio");
    await t.db.insert(messages).values({ mandateId: R, contactId: c.id, channel: "email", toEmail: "erin@test.regenera.bio", subject: "s", body: "b", status: "sent" });
    await t.db.insert(activities).values({ mandateId: R, contactId: c.id, type: "email", detail: "Sent: s to Erin", source: "manual" });
    await t.db.insert(suppression).values({ email: "erin@test.regenera.bio", reason: "unsubscribe" });
    const data = await exportPerson(t.db, [R], c.id, "alan");
    expect(data?.messages).toHaveLength(1);
    expect(await exportPerson(t.db, [RA], c.id, "alan")).toBeNull(); // other mandates cannot export
    const r = await erasePerson(t.db, [R], c.id, "alan");
    expect(r).toMatchObject({ messages: 1, activities: 1 });
    expect(await t.db.select().from(contacts).where(eq(contacts.id, c.id))).toHaveLength(0);
    const sup = await t.db.select().from(suppression);
    expect(sup.map(s => s.email)).toEqual([await hashedSuppressionKey("erin@test.regenera.bio")]);
    expect(JSON.stringify(await t.db.select().from(activities))).not.toContain("Erin");
    expect(JSON.stringify(await t.db.select().from(privacyRequests))).not.toContain("erin@");
    const back = await person(R, "Erin Again", "ERIN@test.regenera.bio");
    expect(back.suppressed).toBe(true);
  });
});

describe("prospecting playbooks", () => {
  it("every segment has LinkedIn, Google and Sales Navigator searches and one clear message", async () => {
    const segs = await t.db.select().from(segments);
    for (const s of segs) {
      const pb = buildPlaybook(s, "latam");
      expect(pb.searches.linkedinPeople).toMatch(/^https:\/\/www\.linkedin\.com\/search\/results\/people\/\?keywords=/);
      expect(decodeURIComponent(pb.searches.googlePeople)).toContain("site:linkedin.com/in");
      expect(decodeURIComponent(pb.searches.googlePeople)).toContain("Peru");
      expect(pb.message.oneLiner.length).toBeGreaterThan(30);
      expect(pb.who.titles.length).toBeGreaterThan(0);
    }
  });

  it("writes templates that pass house style (one retry) and turns them into one sequence", async () => {
    const seg = (await t.db.select().from(segments).where(eq(segments.key, "epc_engineering")))[0];
    const good = { messages: [
      { step: 0, subject: "", body: "{first_name}, Regenera helps EPC teams reach bid stage with projects that are ready. Glad to connect." },
      { step: 1, subject: "Projects ready at bid stage", body: "{first_name}, {organization} bids on projects that often stall before financial close. Regenera prepares them so the bid holds. Would a short call about the Partner Network be useful?" },
      { step: 2, subject: "", body: "A recent Field Note on grid access for EPC bids, in case it is useful." },
      { step: 3, subject: "A sharper view", body: "One example of a project we prepared before the EPC bid. Happy to walk through it." },
      { step: 4, subject: "Closing the loop", body: "I will leave it here. The door stays open." },
    ] };
    const badFirst = { messages: good.messages.map(m => (m.step === 1 ? { ...m, body: "Great news — we guarantee returns!" } : m)) };
    const fake = fakeAnthropic([badFirst, good]);
    expect(await draftPlaybookTemplates(t.db, AI, R, seg.id, fake.client)).toBe(5);
    expect(fake.calls).toHaveLength(2);
    const drafts = await t.db.select().from(playbookDrafts);
    expect(drafts.every(d => !d.styleIssues)).toBe(true);
    const s1 = await playbookSequence(t.db, R, seg.id);
    const s2 = await playbookSequence(t.db, R, seg.id);
    expect(s1.id).toBe(s2.id);
    expect(s1.steps[1].purpose).toContain("Adapt this approved template");
    expect((await t.db.select().from(sequences).where(and(eq(sequences.mandateId, R), eq(sequences.key, "pb:epc_engineering"))))).toHaveLength(1);
  });
});
