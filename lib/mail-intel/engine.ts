// Mail intelligence engine (spec §4–§33). SOURCE: ingestBatch stores raw messages idempotently (account + Gmail id),
// enforces the historical window and the spam/trash exclusion in code, and keeps a checkpoint. DERIVED: rebuild()
// recomputes threads, the contact universe, campaigns and engagement states from the stored messages (safe to rerun).
// CANONICAL: promotion to CRM contacts / organizations and activities is conservative (exact email or domain only;
// anything uncertain goes to the review queue). applyExtraction() writes model extractions as facts with provenance.
// Nothing here calls Gmail with a write scope; nothing sends, labels, moves or deletes mail.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import {
  activities, capitalProfiles, contacts, deals, documents, mailAttachments, mailCampaignRecipients, mailCampaigns, mailCheckpoints, mailFacts, mailIngestionRuns, mailIntroductions, mailMessages,
  mailObligations, mailPeople, mailReviewItems, mailSources, mailThreads, organizations, projects, tasks,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { normalizeOrgName } from "@/lib/dedupe/normalize";
import { createProject } from "@/lib/projects/engine";
import { classify, domainOf, engagement, hash, INGESTION_VERSION, isFreeMail, LOW_SIGNAL, newText, parseAddress, SCHEMA_VERSION, SIGNALS, templateOf, type MailClass, type RawMessage } from "./classify";

type Source = typeof mailSources.$inferSelect;
const BODY_MAX = 20_000;
const chunk = <T,>(a: T[], n = 80) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export async function ensureSource(db: Db, input: { account: string; mandateId: string; ownAddresses: string[]; boundaryStart: string; boundaryEnd: string; transport?: "gmail_api" | "import" }, actor: string) {
  const own = [...new Set([input.account, ...input.ownAddresses].map(a => a.toLowerCase()))];
  await db.insert(mailSources).values({ ...input, ownAddresses: own, transport: input.transport ?? "import", connectedBy: actor })
    .onConflictDoUpdate({ target: mailSources.account, set: { mandateId: input.mandateId, ownAddresses: own, boundaryStart: input.boundaryStart, boundaryEnd: input.boundaryEnd, updatedAt: new Date().toISOString() } });
  const [s] = await db.select().from(mailSources).where(eq(mailSources.account, input.account));
  await db.insert(mailCheckpoints).values({ account: input.account, boundaryStart: input.boundaryStart, boundaryEnd: input.boundaryEnd, ingestionVersion: INGESTION_VERSION, extractionModel: "none", schemaVersion: SCHEMA_VERSION }).onConflictDoNothing();
  await audit(db, { actor, action: "mail_source_configured", entity: "mail_sources", entityId: input.account, after: { boundary: [input.boundaryStart, input.boundaryEnd], mandateId: input.mandateId } });
  return s;
}

export async function startRun(db: Db, s: Source, transport: string, actor: string, model = "none") {
  const [r] = await db.insert(mailIngestionRuns).values({ account: s.account, transport, boundaryStart: s.boundaryStart, boundaryEnd: s.boundaryEnd, ingestionVersion: INGESTION_VERSION, extractionModel: model, schemaVersion: SCHEMA_VERSION, startedBy: actor }).returning();
  await audit(db, { actor, action: "mail_ingestion_start", entity: "mail_ingestion_runs", entityId: r.id, after: { account: s.account, boundary: `after:${s.boundaryStart} before:${s.boundaryEnd} -in:spam -in:trash` } });
  return r;
}

/** §25 Idempotent batch: the same message twice is one row; outside-window and spam/trash are counted, not stored. */
export async function ingestBatch(db: Db, account: string, batch: RawMessage[], batchId: string) {
  const [s] = await db.select().from(mailSources).where(eq(mailSources.account, account));
  if (!s) throw new Error("Configure the mail source first");
  const counts = { received: batch.length, stored: 0, duplicate: 0, outside_window: 0, spam_trash: 0 };
  const endExclusive = new Date(Date.parse(`${s.boundaryEnd}T00:00:00Z`) + 86_400_000).toISOString();
  const keys = batch.map(m => `${account}:${m.gmailMessageId}`);
  const have = new Set<string>();
  for (const c of chunk(keys)) for (const r of await db.select({ key: mailMessages.key }).from(mailMessages).where(inArray(mailMessages.key, c))) have.add(r.key);
  let last: RawMessage | null = null;
  for (const m of batch) {
    const key = `${account}:${m.gmailMessageId}`;
    if (m.internalDate < `${s.boundaryStart}T00:00:00Z` || m.internalDate >= endExclusive) { counts.outside_window++; continue; }
    if (!s.includeSpamTrash && (m.labels.includes("SPAM") || m.labels.includes("TRASH"))) { counts.spam_trash++; continue; }
    if (have.has(key)) { counts.duplicate++; continue; }
    const from = parseAddress(m.from);
    const own = s.ownAddresses;
    const { mailClass, basis } = classify(m, own);
    const body = m.body ?? null;
    await db.insert(mailMessages).values({
      key, mandateId: s.mandateId, account, gmailMessageId: m.gmailMessageId, gmailThreadId: m.gmailThreadId, internalDate: m.internalDate, fromEmail: from.email, fromName: from.name,
      to: m.to.map(a => parseAddress(a).email), cc: m.cc.map(a => parseAddress(a).email), bcc: m.bcc.map(a => parseAddress(a).email), replyTo: m.replyTo ?? null, subject: m.subject, snippet: m.snippet,
      body: body ? body.slice(0, BODY_MAX) : null, bodyTruncated: !!body && body.length > BODY_MAX, direction: own.includes(from.email) ? "sent" : "received", labels: m.labels,
      hasAttachment: !!m.attachments?.length, attachmentIds: (m.attachments ?? []).map(a => a.id), inReplyTo: m.inReplyTo ?? null, references: m.references ?? null, displayUrl: m.displayUrl ?? null,
      rawHash: hash(JSON.stringify([m.gmailMessageId, m.internalDate, m.from, m.to, m.cc, m.subject, body ?? m.snippet])), batchId, mailClass, classBasis: basis,
    }).onConflictDoNothing();
    for (const a of m.attachments ?? []) await db.insert(mailAttachments).values({ mandateId: s.mandateId, messageKey: key, attachmentId: a.id, filename: a.filename, mimeType: a.mimeType ?? "", size: a.size ?? null, documentType: docType(a.filename) }).onConflictDoNothing();
    counts.stored++;
    if (!last || m.internalDate > last.internalDate) last = m;
  }
  const [cp] = await db.select().from(mailCheckpoints).where(eq(mailCheckpoints.account, account));
  await db.update(mailCheckpoints).set({ batchNumber: (cp?.batchNumber ?? 0) + 1, processed: (cp?.processed ?? 0) + counts.stored, ...(last ? { lastInternalDate: last.internalDate, lastMessageId: last.gmailMessageId } : {}), status: "running", updatedAt: new Date().toISOString() }).where(eq(mailCheckpoints.account, account));
  return counts;
}

export function docType(filename: string) {
  const f = filename.toLowerCase();
  if (/\bnda\b|non.?disclosure|confidential/.test(f)) return "nda";
  if (/\bloi\b|letter of intent/.test(f)) return "loi";
  if (/term ?sheet/.test(f)) return "term_sheet";
  if (/\bppa\b|power purchase/.test(f)) return "ppa";
  if (/model|\.xlsx?$|\.xlsm$|\.csv$/.test(f)) return /model/.test(f) ? "financial_model" : "spreadsheet";
  if (/deck|pitch|presentation|\.pptx?$|teaser/.test(f)) return "pitch_deck";
  if (/\bim\b|memorandum|memo/.test(f)) return "investment_memo";
  if (/epc|quotation|quote/.test(f)) return "epc_quotation";
  if (/proposal/.test(f)) return "project_proposal";
  if (/permit|license|licence/.test(f)) return "permit";
  if (/\.(kml|kmz|shp|geojson|gpkg)$/.test(f)) return "gis";
  if (/\.(jpe?g|png|heic)$/.test(f)) return "photo";
  if (/study|report|assessment|analysis/.test(f)) return "technical_study";
  if (/contract|agreement/.test(f)) return "contract";
  return "other";
}

/** Recomputes derived layers from stored messages. Safe to rerun; canonical CRM rows are only added, never removed. */
export async function rebuild(db: Db, account: string, actor: string, now = new Date()) {
  const [s] = await db.select().from(mailSources).where(eq(mailSources.account, account));
  if (!s) throw new Error("Unknown mail source");
  const msgs = await db.select().from(mailMessages).where(eq(mailMessages.account, account)).orderBy(mailMessages.internalDate);
  const own = new Set(s.ownAddresses);
  // Reclassify with the current rules (classification is derived, the source message is not), then demote repeated
  // unsolicited senders I never wrote to (fund-marketing drips, course funnels) from correspondence to marketing.
  const sentTo = new Set(msgs.filter(m => m.direction === "sent").flatMap(m => [...m.to, ...m.cc]));
  const inboundThreads = new Map<string, Set<string>>();
  for (const m of msgs) {
    if (m.campaignId) continue;
    const c = classify({ account, gmailMessageId: m.gmailMessageId, gmailThreadId: m.gmailThreadId, internalDate: m.internalDate, from: m.fromName ? `${m.fromName} <${m.fromEmail}>` : m.fromEmail, to: m.to, cc: m.cc, bcc: m.bcc, subject: m.subject, snippet: m.snippet, body: m.body, labels: m.labels, attachments: [] } satisfies RawMessage, [...own]);
    if (c.mailClass !== m.mailClass) { m.mailClass = c.mailClass; m.classBasis = c.basis; await db.update(mailMessages).set({ mailClass: c.mailClass, classBasis: c.basis }).where(eq(mailMessages.key, m.key)); }
    if (m.direction === "received" && m.mailClass === "substantive") inboundThreads.set(m.fromEmail, (inboundThreads.get(m.fromEmail) ?? new Set()).add(m.gmailThreadId));
  }
  for (const m of msgs) if (m.direction === "received" && m.mailClass === "substantive" && !sentTo.has(m.fromEmail) && (inboundThreads.get(m.fromEmail)?.size ?? 0) >= 3) {
    m.mailClass = "marketing"; m.classBasis = "repeated unsolicited sender, never answered";
    await db.update(mailMessages).set({ mailClass: m.mailClass, classBasis: m.classBasis }).where(eq(mailMessages.key, m.key));
  }
  const byThread = new Map<string, typeof msgs>();
  for (const m of msgs) byThread.set(m.gmailThreadId, [...(byThread.get(m.gmailThreadId) ?? []), m]);

  // ---- campaigns (§9): my outbound mail sharing a template to ≥ 3 distinct external recipients ----
  const sentFirst = msgs.filter(m => m.direction === "sent" && m.mailClass === "substantive");
  const groups = new Map<string, typeof msgs>();
  for (const m of sentFirst) {
    const t = templateOf(m.subject, newText(m.body ?? m.snippet));
    groups.set(hash(t.key), [...(groups.get(hash(t.key)) ?? []), m]);
  }
  const campaignOf = new Map<string, string>();
  for (const [th, list] of groups) {
    const recips = new Set(list.flatMap(m => [...m.to, ...m.cc]).filter(e => !own.has(e)));
    if (recips.size < 3) continue;
    const t = templateOf(list[0].subject, newText(list[0].body ?? list[0].snippet));
    await db.insert(mailCampaigns).values({ mandateId: s.mandateId, account, name: list[0].subject.replace(/^(re|fwd?):\s*/i, "").slice(0, 120) || "Untitled campaign", templateHash: th, subjectTemplate: t.subject, startedAt: list[0].internalDate, endedAt: list[list.length - 1].internalDate, purpose: newText(list[0].body ?? list[0].snippet).slice(0, 300) })
      .onConflictDoUpdate({ target: [mailCampaigns.account, mailCampaigns.templateHash], set: { endedAt: list[list.length - 1].internalDate, updatedAt: now.toISOString() } });
    const [c] = await db.select({ id: mailCampaigns.id }).from(mailCampaigns).where(and(eq(mailCampaigns.account, account), eq(mailCampaigns.templateHash, th)));
    for (const m of list) campaignOf.set(m.key, c.id);
    for (const c2 of chunk(list.map(m => m.key))) await db.update(mailMessages).set({ mailClass: "cold_outreach", campaignId: c.id }).where(and(inArray(mailMessages.key, c2), eq(mailMessages.mailClass, "substantive")));
  }

  // ---- people (§6, §8, §30): evidence per external address ----
  type Ev = { email: string; name: string; sent: number; received: number; replies: number; meetings: number; docs: number; materialsRequested: number; ndaRequested: boolean; ndaExecuted: boolean; proposal: boolean; declined: boolean; firstAt: string; lastAt: string; lowOnly: boolean; campaign: boolean; inbound: boolean; system: boolean; evidence: { at: string; what: string; messageKey: string }[] };
  const people = new Map<string, Ev>();
  const get = (email: string, name: string, at: string) => {
    let p = people.get(email);
    if (!p) { p = { email, name, sent: 0, received: 0, replies: 0, meetings: 0, docs: 0, materialsRequested: 0, ndaRequested: false, ndaExecuted: false, proposal: false, declined: false, firstAt: at, lastAt: at, lowOnly: true, campaign: false, inbound: false, system: false, evidence: [] }; people.set(email, p); }
    if (name && !p.name) p.name = name;
    if (at < p.firstAt) p.firstAt = at; if (at > p.lastAt) p.lastAt = at;
    return p;
  };
  for (const [, list] of byThread) {
    let iSent = false;
    for (const m of list) {
      const low = LOW_SIGNAL.includes(m.mailClass as MailClass);
      const text = newText(m.body ?? m.snippet);
      const cal = m.mailClass === "calendar";
      if (m.direction === "sent") {
        iSent = true;
        for (const e of [...m.to, ...m.cc].filter(x => !own.has(x))) {
          const p = get(e, "", m.internalDate); p.sent++; if (!low) p.lowOnly = false;
          if (campaignOf.has(m.key)) p.campaign = true;
          if (m.hasAttachment) { p.docs++; p.evidence.push({ at: m.internalDate, what: "materials shared", messageKey: m.key }); }
          if (SIGNALS.ndaRequested.test(text)) p.ndaRequested = true;
          if (SIGNALS.proposal.test(m.subject)) p.proposal = true;
          if (cal || SIGNALS.meeting.test(text)) { p.meetings++; p.evidence.push({ at: m.internalDate, what: "meeting", messageKey: m.key }); }
        }
      } else {
        const p = get(m.fromEmail, m.fromName, m.internalDate);
        p.received++; if (!low) p.lowOnly = false;
        if (/^(no-?reply|noreply|notifications?|mailer-daemon)/.test(m.fromEmail) || m.mailClass === "internal_system") p.system = true;
        if (iSent && !low) { p.replies++; p.evidence.push({ at: m.internalDate, what: "replied", messageKey: m.key }); }
        else if (!low && !cal) { p.inbound = true; }
        if (cal || SIGNALS.meeting.test(text)) { p.meetings++; p.evidence.push({ at: m.internalDate, what: cal ? "calendar" : "meeting", messageKey: m.key }); }
        if (SIGNALS.materialsRequested.test(text)) { p.materialsRequested++; p.evidence.push({ at: m.internalDate, what: "materials requested", messageKey: m.key }); }
        if (SIGNALS.ndaExecuted.test(text)) p.ndaExecuted = true; else if (SIGNALS.ndaRequested.test(text) && !low) p.ndaRequested = true;
        if (!low && SIGNALS.proposal.test(`${m.subject} ${text.slice(0, 600)}`)) p.proposal = true;
        if (!low && SIGNALS.declined.test(text)) p.declined = true;
        if (m.hasAttachment && !low) { p.docs++; p.evidence.push({ at: m.internalDate, what: "materials received", messageKey: m.key }); }
        for (const e of m.cc.filter(x => !own.has(x) && x !== m.fromEmail)) { const q = get(e, "", m.internalDate); if (!low) q.lowOnly = false; }
        if (!low && SIGNALS.introduction.test(text)) {
          for (const e of [...m.to, ...m.cc].filter(x => !own.has(x) && x !== m.fromEmail)) await db.insert(mailIntroductions).values({ mandateId: s.mandateId, introducerEmail: m.fromEmail, introducedEmail: e, date: m.internalDate, context: m.subject, sourceMessageKey: m.key }).onConflictDoNothing();
        }
      }
    }
  }
  const existing = new Map((await db.select().from(mailPeople).where(eq(mailPeople.mandateId, s.mandateId))).map(p => [p.email, p]));
  for (const p of people.values()) {
    const e = engagement({ ...p, materialsShared: p.docs, lastAt: p.lastAt, now: now.toISOString() });
    const lowSignal = p.lowOnly || p.system;
    const v = { name: p.name, domain: domainOf(p.email), kind: p.system ? "system" : "person", firstAt: p.firstAt, lastAt: p.lastAt, sentCount: p.sent, receivedCount: p.received, replyCount: p.replies, meetingCount: p.meetings, docsCount: p.docs,
      engagementState: e.state, relationshipStage: e.stage, strength: e.strength, responseQuality: e.responseQuality, commercialStage: p.proposal ? "proposal" : p.ndaExecuted ? "nda" : "none",
      origin: p.campaign ? "campaign" : p.inbound && !p.sent ? "inbound" : p.sent && !p.received ? "cold_outreach" : "correspondence", lowSignal, evidence: p.evidence.slice(-25), updatedAt: now.toISOString() };
    if (existing.has(p.email)) await db.update(mailPeople).set(v).where(eq(mailPeople.id, existing.get(p.email)!.id));
    else await db.insert(mailPeople).values({ mandateId: s.mandateId, email: p.email, ...v });
  }

  // ---- campaign recipients ----
  const camps = await db.select().from(mailCampaigns).where(eq(mailCampaigns.account, account));
  for (const c of camps) {
    const cm = msgs.filter(m => m.campaignId === c.id);
    const recips = new Map<string, typeof cm>();
    for (const m of cm) for (const e of [...m.to, ...m.cc].filter(x => !own.has(x))) recips.set(e, [...(recips.get(e) ?? []), m]);
    let replied = 0, meetings = 0, material = 0;
    for (const [email, list] of recips) {
      const threads = new Set(list.map(m => m.gmailThreadId));
      const theirs = msgs.filter(m => m.direction === "received" && m.fromEmail === email && m.internalDate >= list[0].internalDate);
      const inThread = theirs.some(m => threads.has(m.gmailThreadId)) || theirs.length > 0;
      const p = people.get(email);
      const met = (p?.meetings ?? 0) > 0, mat = (p?.docs ?? 0) > 0;
      if (inThread) replied++; if (met) meetings++; if (mat) material++;
      const txt = theirs.map(m => newText(m.body ?? m.snippet)).join(" ");
      const responseType = !inThread ? "none" : SIGNALS.declined.test(txt) ? "negative" : /interest|keen|happy to|let'?s|call|meet|send|more info|learn more/i.test(txt) ? "positive" : "neutral";
      await db.insert(mailCampaignRecipients).values({ campaignId: c.id, email, firstSentAt: list[0].internalDate, lastContactAt: [...list, ...theirs].map(m => m.internalDate).sort().at(-1)!, followUps: Math.max(0, list.length - 1), replied: inThread, responseType, meetingHeld: met, materialsShared: mat, commercialStage: met ? "meeting_held" : inThread ? "replied" : list.length > 1 ? "followed_up" : "cold_emailed", messageKeys: [...list, ...theirs].map(m => m.key).slice(0, 40) })
        .onConflictDoUpdate({ target: [mailCampaignRecipients.campaignId, mailCampaignRecipients.email], set: { lastContactAt: [...list, ...theirs].map(m => m.internalDate).sort().at(-1)!, followUps: Math.max(0, list.length - 1), replied: inThread, responseType, meetingHeld: met, materialsShared: mat, commercialStage: met ? "meeting_held" : inThread ? "replied" : list.length > 1 ? "followed_up" : "cold_emailed" } });
    }
    await db.update(mailCampaigns).set({ counts: { recipients: recips.size, replies: replied, positive: 0, meetings, materials: material, messages: cm.length } }).where(eq(mailCampaigns.id, c.id));
  }

  // ---- canonical promotion (conservative): real counterparties become CRM contacts / organizations ----
  const mp = await db.select().from(mailPeople).where(and(eq(mailPeople.mandateId, s.mandateId), eq(mailPeople.lowSignal, false), eq(mailPeople.kind, "person")));
  let promoted = 0;
  for (const p of mp) {
    if (p.contactId) continue;
    const [c] = await db.select({ id: contacts.id, orgId: contacts.orgId }).from(contacts).where(and(eq(contacts.mandateId, s.mandateId), eq(contacts.emailLower, p.email)));
    let orgId = c?.orgId ?? null;
    if (!orgId && !isFreeMail(p.domain)) {
      const [o] = await db.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.mandateId, s.mandateId), eq(organizations.domain, p.domain)));
      if (o) orgId = o.id;
      else {
        const label = p.domain.split(".")[0].replace(/[-_]/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());
        const [n] = await db.insert(organizations).values({ mandateId: s.mandateId, name: label, nameNormalized: normalizeOrgName(label), domain: p.domain, website: `https://${p.domain}`, source: "email", description: "Created from email correspondence; name derived from the domain (review).", fieldSources: { name: { source: "gmail", at: now.toISOString() } } as never }).onConflictDoNothing().returning({ id: organizations.id });
        orgId = n?.id ?? null;
      }
    }
    let contactId = c?.id ?? null;
    if (!contactId) {
      const name = p.name || p.email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());
      const [first, ...rest] = name.split(" ");
      const [n] = await db.insert(contacts).values({ mandateId: s.mandateId, orgId, firstName: first ?? "", lastName: rest.join(" "), fullName: name, nameNormalized: name.toLowerCase(), email: p.email, emailLower: p.email, source: "email", leadState: p.replyCount || p.meetingCount ? "engaged" as never : "sourced", fieldSources: { email: { source: "gmail", at: now.toISOString() } } as never }).onConflictDoNothing().returning({ id: contacts.id });
      contactId = n?.id ?? null; promoted++;
    }
    await db.update(mailPeople).set({ contactId, orgId }).where(eq(mailPeople.id, p.id));
  }

  // ---- threads (§5) and timeline activities for substantive mail ----
  const personOf = new Map((await db.select({ email: mailPeople.email, contactId: mailPeople.contactId, orgId: mailPeople.orgId }).from(mailPeople).where(eq(mailPeople.mandateId, s.mandateId))).map(p => [p.email, p]));
  const logged = new Set((await db.select({ method: activities.method }).from(activities).where(and(eq(activities.mandateId, s.mandateId), sql`${activities.method} like 'gmail:%'`))).map(a => a.method));
  for (const [tid, list] of byThread) {
    const parts = [...new Set(list.flatMap(m => [m.fromEmail, ...m.to, ...m.cc]).filter(e => !own.has(e)))];
    const classes = list.map(m => m.mailClass as MailClass);
    const cls: MailClass = classes.includes("substantive") ? "substantive" : classes.includes("cold_outreach") ? "cold_outreach" : classes.includes("calendar") ? "calendar" : classes[0];
    const lastSubst = [...list].reverse().find(m => !LOW_SIGNAL.includes(m.mailClass as MailClass));
    const states = parts.map(e => people.get(e)).filter(Boolean).map(p => engagement({ ...p!, materialsShared: p!.docs, lastAt: p!.lastAt, now: now.toISOString() }).state);
    const order = ["identified", "cold_emailed", "followed_up", "dormant", "replied", "materials_requested", "materials_shared", "meeting_held", "nda_requested", "nda_executed", "proposal_sent", "proposal_received", "declined"];
    const state = states.sort((a, b) => order.indexOf(b) - order.indexOf(a))[0] ?? "identified";
    const v = { mandateId: s.mandateId, account, gmailThreadId: tid, subject: list[0].subject, firstAt: list[0].internalDate, lastAt: list[list.length - 1].internalDate, messageCount: list.length, sentCount: list.filter(m => m.direction === "sent").length, receivedCount: list.filter(m => m.direction === "received").length,
      participants: parts.slice(0, 40), mailClass: cls, state, lastDirection: list[list.length - 1].direction, // A reply is "owed by me" only inside an exchange (I wrote in this thread or to this sender before);
      // unsolicited inbound I never answered is "unanswered", not a debt.
      awaitingReplyFrom: !lastSubst || cls === "calendar" ? null : lastSubst.direction === "sent" ? "them" : list.some(m => m.direction === "sent") || sentTo.has(lastSubst.fromEmail) ? "me" : "unanswered",
      contactIds: [...new Set(parts.map(e => personOf.get(e)?.contactId).filter((x): x is string => !!x))], orgIds: [...new Set(parts.map(e => personOf.get(e)?.orgId).filter((x): x is string => !!x))], updatedAt: now.toISOString() };
    await db.insert(mailThreads).values({ key: `${account}:${tid}`, ...v }).onConflictDoUpdate({ target: mailThreads.key, set: v });
    for (const m of list) {
      if (LOW_SIGNAL.includes(m.mailClass as MailClass) || logged.has(`gmail:${m.key}`)) continue;
      const counter = m.direction === "sent" ? m.to.find(e => !own.has(e)) : m.fromEmail;
      const link = counter ? personOf.get(counter) : undefined;
      if (!link?.contactId && !link?.orgId) continue;
      await db.insert(activities).values({ mandateId: s.mandateId, contactId: link.contactId, orgId: link.orgId, type: m.mailClass === "calendar" ? "meeting" : "email", method: `gmail:${m.key}`, detail: `${m.direction === "sent" ? "Sent" : "Received"}: ${m.subject}`.slice(0, 300), occurredAt: m.internalDate, source: "import", actor: "gmail-import" });
      logged.add(`gmail:${m.key}`);
    }
  }
  await audit(db, { actor, action: "mail_rebuild", entity: "mail_sources", entityId: account, after: { messages: msgs.length, threads: byThread.size, people: people.size, campaigns: camps.length, promoted } });
  return { messages: msgs.length, threads: byThread.size, people: people.size, campaigns: camps.length, promoted };
}

// ---------- §27 extraction (Claude API job, or a supplied extraction file) ----------
export type Extraction = {
  threadKey: string; summary: string; mailClass?: MailClass;
  people?: { email?: string; name: string; title?: string; organization?: string; role?: string }[];
  organizations?: { name: string; domain?: string; type: string; geography?: string }[];
  projects?: { name: string; aliases?: string[]; geography?: string; country?: string; assetClass?: string; technology?: string; capacityMw?: number; capex?: number; currency?: string; capitalRequired?: number; stage?: string; sponsor?: string; ppaStatus?: string; landStatus?: string; gridStatus?: string; permitStatus?: string; financingStructure?: string; blockers?: string[]; confidentiality?: string }[];
  capitalProviders?: { organization: string; type: string; geography?: string; ticketMin?: number; ticketMax?: number; currency?: string; preferences?: string; mandateSummary?: string }[];
  deals?: { name: string; organization?: string; stage: string; financingStructure?: string; projectName?: string }[];
  commitments?: { byMe: boolean; actor: string; counterparty: string; text: string; firm: boolean; dueDate?: string | null; messageId: string; confidence: number; done?: boolean }[];
  requests?: { byMe: boolean; actor: string; counterparty: string; text: string; dueDate?: string | null; messageId: string; confidence: number; done?: boolean }[];
  introductions?: { introducer: string; introduced: string; organization?: string; context: string; messageId: string }[];
  documents?: { filename: string; type: string; messageId: string; confidentiality?: string; ndaCovered?: string; projectName?: string }[];
  facts?: { entityType: string; entity: string; field: string; value: string; factType: "explicit" | "derived" | "hypothesis"; effectiveDate?: string; messageId: string; confidence: number }[];
  ndaStatus?: string | null; reviews?: { kind: string; title: string; detail?: Record<string, unknown>; messageId?: string }[];
};

const STAGE: Record<string, string> = { opportunity: "opportunity", screening: "screening", diagnostic: "diagnostic", development: "development", construction: "construction", operations: "operations" };

export async function applyExtraction(db: Db, account: string, x: Extraction, model: string, actor: string) {
  const [s] = await db.select().from(mailSources).where(eq(mailSources.account, account));
  if (!s) throw new Error("Unknown mail source");
  const M = s.mandateId;
  const [t] = await db.select().from(mailThreads).where(eq(mailThreads.key, x.threadKey));
  if (!t) throw new Error(`Thread not ingested: ${x.threadKey}`);
  const mk = (id: string) => `${account}:${id}`;
  const firstKey = mk(t.gmailThreadId);
  const orgIds = new Set(t.orgIds), projectIds = new Set(t.projectIds), dealIds = new Set(t.dealIds);
  const orgByName = async (name: string, domain?: string, type?: string) => {
    const norm = normalizeOrgName(name);
    const [o] = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(and(eq(organizations.mandateId, M), domain ? sql`(${organizations.domain} = ${domain} or ${organizations.nameNormalized} = ${norm})` : eq(organizations.nameNormalized, norm)));
    if (o) {
      // A domain-derived placeholder name is upgraded to the stated name (and recorded as a fact).
      if (domain && o.name.toLowerCase() === domain.split(".")[0].replace(/[-_]/g, " ")) await db.update(organizations).set({ name, nameNormalized: norm }).where(eq(organizations.id, o.id));
      orgIds.add(o.id); return o.id;
    }
    const [n] = await db.insert(organizations).values({ mandateId: M, name, nameNormalized: norm, domain: domain ?? null, source: "email", industry: type ?? null, description: `From email (${model}).` }).onConflictDoNothing().returning({ id: organizations.id });
    if (n) orgIds.add(n.id);
    return n?.id ?? null;
  };
  for (const o of x.organizations ?? []) await orgByName(o.name, o.domain, o.type);
  for (const p of x.people ?? []) if (p.email) {
    const [c] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.mandateId, M), eq(contacts.emailLower, p.email.toLowerCase())));
    if (c) { await db.update(contacts).set({ ...(p.title ? { title: p.title } : {}), fullName: p.name, nameNormalized: p.name.toLowerCase(), firstName: p.name.split(" ")[0], lastName: p.name.split(" ").slice(1).join(" ") }).where(eq(contacts.id, c.id)); }
    if (p.organization) { const oid = await orgByName(p.organization, domainOf(p.email.toLowerCase()) && !isFreeMail(domainOf(p.email.toLowerCase())) ? domainOf(p.email.toLowerCase()) : undefined); if (c && oid) await db.update(contacts).set({ orgId: oid }).where(eq(contacts.id, c.id)); }
    await db.update(mailPeople).set({ name: p.name, relevance: p.role ?? "unknown" }).where(and(eq(mailPeople.mandateId, M), eq(mailPeople.email, p.email.toLowerCase())));
  }
  for (const p of x.projects ?? []) {
    const norm = p.name.trim().toLowerCase();
    const [ex] = await db.select().from(projects).where(and(eq(projects.mandateId, M), sql`lower(${projects.name}) = ${norm}`));
    const id = ex?.id ?? (await createProject(db, { mandateId: M, name: p.name.trim(), description: `Surfaced from email correspondence (${x.summary.slice(0, 280)})`, country: p.country ?? null, subdivision: p.geography ?? null, technology: p.technology ?? null, capacity: p.capacityMw ?? null, capacityUnit: p.capacityMw ? "MW" : null, capex: p.capex ?? null, currency: p.currency ?? null, stage: (STAGE[p.stage ?? ""] ?? "opportunity") as never, originationSource: "Gmail import" }, actor)).id;
    projectIds.add(id);
    if (ex) for (const [f, v] of [["capacity", p.capacityMw], ["capex", p.capex]] as const) if (v != null && ex[f] != null && Number(ex[f]) !== v) await db.insert(mailReviewItems).values({ mandateId: M, kind: "conflict", title: `${p.name}: ${f} ${ex[f]} → ${v}`, detail: { projectId: id, field: f, before: ex[f], after: v }, sourceMessageKey: firstKey });
    const facts: [string, unknown][] = [["capacity_mw", p.capacityMw], ["capex", p.capex && `${p.capex} ${p.currency ?? ""}`], ["capital_required", p.capitalRequired && `${p.capitalRequired} ${p.currency ?? ""}`], ["technology", p.technology], ["geography", p.geography], ["ppa_status", p.ppaStatus], ["land_status", p.landStatus], ["grid_status", p.gridStatus], ["permit_status", p.permitStatus], ["financing_structure", p.financingStructure], ["sponsor", p.sponsor], ["blockers", p.blockers?.join("; ")], ["confidentiality", p.confidentiality]];
    for (const [field, value] of facts) if (value) await fact(db, M, "project", id, p.name, field, String(value), "explicit", firstKey, model, 0.8, t.lastAt);
  }
  for (const c of x.capitalProviders ?? []) {
    const oid = await orgByName(c.organization, undefined, c.type);
    const [cp] = await db.select({ id: capitalProfiles.id }).from(capitalProfiles).where(and(eq(capitalProfiles.mandateId, M), eq(capitalProfiles.name, c.organization)));
    if (!cp) await db.insert(capitalProfiles).values({ mandateId: M, orgId: oid, name: c.organization, capitalType: (["fund", "family_office", "private_individual", "dfi", "bank", "institutional", "foundation", "strategic", "government", "green_bank", "eca", "other"].includes(c.type) ? c.type : "other") as never, notes: `${c.mandateSummary ?? ""} (from email; unverified)`.trim(), source: "Gmail import", impact: c.preferences ?? "" }).onConflictDoNothing();
    await fact(db, M, "capital_provider", oid, c.organization, "mandate_summary", c.mandateSummary ?? c.preferences ?? c.type, "derived", firstKey, model, 0.6, t.lastAt);
  }
  for (const d of x.deals ?? []) {
    const oid = d.organization ? await orgByName(d.organization) : null;
    const [ex] = await db.select({ id: deals.id }).from(deals).where(and(eq(deals.mandateId, M), eq(deals.name, d.name)));
    const pid = d.projectName ? (await db.select({ id: projects.id }).from(projects).where(and(eq(projects.mandateId, M), sql`lower(${projects.name}) = ${d.projectName.toLowerCase()}`)))[0]?.id ?? null : null;
    const id = ex?.id ?? (await db.insert(deals).values({ mandateId: M, orgId: oid, name: d.name, path: "project_diagnostic", stage: (["lead", "contacted", "engaged", "call_booked", "proposal", "signed", "active", "nurture", "lost"].includes(d.stage) ? d.stage : "lead") as never, source: "email", projectId: pid, notes: `From email: ${x.summary.slice(0, 400)}` }).returning({ id: deals.id }))[0].id;
    dealIds.add(id);
  }
  for (const [kind, list] of [["commitment", x.commitments ?? []], ["request", x.requests ?? []]] as const) for (const o of list) {
    const key = mk(o.messageId);
    const [dup] = await db.select({ id: mailObligations.id }).from(mailObligations).where(and(eq(mailObligations.sourceMessageKey, key), eq(mailObligations.text, o.text)));
    if (dup) continue;
    const firm = "firm" in o ? o.firm : true;
    let taskId: string | null = null;
    if (!o.done && ((kind === "commitment" && o.byMe) || (kind === "request" && !o.byMe))) {
      const due = o.dueDate ?? new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
      const cid = t.contactIds[0] ?? null;
      [{ id: taskId }] = await db.insert(tasks).values({ mandateId: M, contactId: cid, orgId: t.orgIds[0] ?? null, type: "follow_up", title: `${kind === "commitment" ? "My commitment" : "Asked of me"}: ${o.text}`.slice(0, 200), body: `From email "${t.subject}" (${key}).${o.dueDate ? "" : " No due date stated."}`, dueAt: `${due}T15:00:00.000Z` }).returning({ id: tasks.id });
    }
    await db.insert(mailObligations).values({ mandateId: M, kind, byMe: o.byMe, actor: o.actor, counterparty: o.counterparty, text: o.text, firm, dueDate: o.dueDate ?? null, status: o.done ? "done" : "open", confidence: o.confidence, taskId, sourceMessageKey: key, projectId: [...projectIds][0] ?? null });
  }
  for (const i of x.introductions ?? []) await db.insert(mailIntroductions).values({ mandateId: M, introducerEmail: i.introducer, introducedEmail: i.introduced, introducedOrg: i.organization ?? null, date: t.lastAt, context: i.context, sourceMessageKey: mk(i.messageId), projectId: [...projectIds][0] ?? null }).onConflictDoNothing();
  for (const d of x.documents ?? []) {
    const key = mk(d.messageId);
    const [a] = await db.select().from(mailAttachments).where(and(eq(mailAttachments.messageKey, key), eq(mailAttachments.filename, d.filename)));
    const pid = d.projectName ? (await db.select({ id: projects.id }).from(projects).where(and(eq(projects.mandateId, M), sql`lower(${projects.name}) = ${d.projectName.toLowerCase()}`)))[0]?.id ?? null : [...projectIds][0] ?? null;
    if (a?.documentId) continue;
    const [msg] = await db.select({ url: mailMessages.displayUrl, at: mailMessages.internalDate }).from(mailMessages).where(eq(mailMessages.key, key));
    const cat = /model|financial/.test(d.type) ? "financial" : /nda|contract|loi|term/.test(d.type) ? "legal" : /study|technical/.test(d.type) ? "technical" : /deck|memo|proposal/.test(d.type) ? "capital" : "commercial";
    const [doc] = await db.insert(documents).values({ mandateId: M, title: d.filename, category: cat as never, confidentiality: d.confidentiality === "restricted" ? "restricted" : "confidential", projectId: pid, url: msg?.url ?? null, notes: `Email attachment (${d.type}); original stays in Gmail. NDA coverage: ${d.ndaCovered ?? "unknown"}.`, effectiveDate: msg?.at.slice(0, 10) ?? null }).returning({ id: documents.id });
    if (a) await db.update(mailAttachments).set({ documentId: doc.id, projectId: pid, documentType: d.type, confidentiality: d.confidentiality ?? "unknown", ndaCovered: d.ndaCovered ?? "unknown" }).where(eq(mailAttachments.id, a.id));
    else await db.insert(mailAttachments).values({ mandateId: M, messageKey: key, attachmentId: `named:${d.filename}`, filename: d.filename, documentType: d.type, documentId: doc.id, projectId: pid, confidentiality: d.confidentiality ?? "unknown", ndaCovered: d.ndaCovered ?? "unknown" }).onConflictDoNothing();
  }
  for (const f of x.facts ?? []) await fact(db, M, f.entityType, null, f.entity, f.field, f.value, f.factType, mk(f.messageId), model, f.confidence, f.effectiveDate ?? t.lastAt);
  for (const r of x.reviews ?? []) await db.insert(mailReviewItems).values({ mandateId: M, kind: r.kind, title: r.title, detail: r.detail ?? {}, sourceMessageKey: r.messageId ? mk(r.messageId) : firstKey });
  if (x.ndaStatus) await fact(db, M, "thread", null, t.subject, "nda_status", x.ndaStatus, "explicit", firstKey, model, 0.8, t.lastAt);
  await db.update(mailThreads).set({ summary: x.summary, ...(x.mailClass ? { mailClass: x.mailClass } : {}), orgIds: [...orgIds], projectIds: [...projectIds], dealIds: [...dealIds], extractedAt: new Date().toISOString(), extractionModel: model }).where(eq(mailThreads.key, x.threadKey));
  if (x.mailClass) await db.update(mailMessages).set({ mailClass: x.mailClass, classBasis: `extraction (${model})` }).where(and(eq(mailMessages.account, account), eq(mailMessages.gmailThreadId, t.gmailThreadId)));
}

/** §19 Append a fact; the latest fact for the same entity + field is superseded, never overwritten. */
export async function fact(db: Db, mandateId: string, entityType: string, entityId: string | null, entityLabel: string, field: string, value: string, factType: "explicit" | "derived" | "hypothesis", sourceMessageKey: string, model: string, confidence: number, effectiveDate: string | null) {
  const [dup] = await db.select({ id: mailFacts.id }).from(mailFacts).where(and(eq(mailFacts.sourceMessageKey, sourceMessageKey), eq(mailFacts.field, field), eq(mailFacts.entityLabel, entityLabel), eq(mailFacts.value, value)));
  if (dup) return dup.id;
  const [prev] = await db.select({ id: mailFacts.id, value: mailFacts.value }).from(mailFacts).where(and(eq(mailFacts.mandateId, mandateId), eq(mailFacts.entityLabel, entityLabel), eq(mailFacts.field, field))).orderBy(sql`${mailFacts.createdAt} desc`).limit(1);
  const [row] = await db.insert(mailFacts).values({ mandateId, entityType, entityId, entityLabel, field, value, factType, effectiveDate, sourceMessageKey, model, confidence, supersedesId: prev && prev.value !== value ? prev.id : null }).returning({ id: mailFacts.id });
  if (prev && prev.value !== value && /capex|capacity|capital|value|price|ticket/.test(field)) await db.insert(mailReviewItems).values({ mandateId, kind: "financial_fact", title: `${entityLabel}: ${field} changed "${prev.value}" → "${value}"`, detail: { before: prev.id, after: row.id }, sourceMessageKey });
  return row.id;
}

export async function finishRun(db: Db, runId: string, counts: Record<string, number>, status = "complete") {
  await db.update(mailIngestionRuns).set({ status, counts, finishedAt: new Date().toISOString() }).where(eq(mailIngestionRuns.id, runId));
}
