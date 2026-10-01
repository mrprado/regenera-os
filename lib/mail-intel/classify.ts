// Mail intelligence, pure part: address normalization, low-signal classification, direction, templates for campaign
// detection, introduction / NDA / meeting / material signals, engagement state and relationship stage from evidence.
// Everything here is deterministic ("derived"); nothing is presented as a fact the email did not state.

export const INGESTION_VERSION = "mail-intel/1";
export const SCHEMA_VERSION = "0045";

export const MAIL_CLASSES = {
  substantive: "Substantive correspondence", cold_outreach: "Cold outreach (sent)", newsletter: "Newsletter", event_announcement: "Event announcement",
  vendor_sales_pitch: "Vendor sales pitch", media_pr_pitch: "Media / PR pitch", software_notification: "Software notification", system_notification: "System notification",
  research_update: "Research update", marketing: "Marketing", irrelevant_or_personal: "Irrelevant or personal", internal_system: "Regenera system mail", calendar: "Calendar",
} as const;
export type MailClass = keyof typeof MAIL_CLASSES;
export const LOW_SIGNAL: MailClass[] = ["newsletter", "event_announcement", "vendor_sales_pitch", "media_pr_pitch", "software_notification", "system_notification", "research_update", "marketing", "irrelevant_or_personal", "internal_system"];

export const ENGAGEMENT_STATES = ["identified", "prospected", "cold_emailed", "followed_up", "replied", "meeting_scheduled", "meeting_held", "materials_requested", "materials_shared", "nda_requested", "nda_executed", "diligence", "proposal_received", "proposal_sent", "term_sheet", "mandate_discussion", "active_mandate", "transaction_process", "declined", "dormant", "closed"] as const;
export type EngagementState = (typeof ENGAGEMENT_STATES)[number];
export const RELATIONSHIP_STAGES = ["target", "contacted", "engaged", "qualified", "active", "strategic", "transactional"] as const;
export type RelationshipStage = (typeof RELATIONSHIP_STAGES)[number];

const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "yahoo.com.mx", "hotmail.es", "msn.com"]);
export const isFreeMail = (domain: string) => FREE_MAIL.has(domain);

/** "Name <a@b>" | "a@b" → { email, name } (lower-cased email). */
export function parseAddress(s: string): { email: string; name: string } {
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const email = (m ? m[2] : s).trim().toLowerCase();
  return { email, name: m ? m[1].trim() : "" };
}
export const domainOf = (email: string) => email.split("@")[1] ?? "";

const SYSTEM_LOCAL = /^(no-?reply|noreply|do-?not-?reply|notifications?|notify|alerts?|mailer-daemon|postmaster|bounce|updates?|news|newsletter|info|hello|team|support|billing|receipts?|calendar-notification|drive-shares-dm-noreply|comments-noreply|sc-noreply|tagmanager-noreply|businessprofile-noreply|marketing|events?|education|knowhow|advantage)([+.-].*)?$/;
const SOFTWARE_DOMAINS = /(slack|slackhq|google|github|vercel|cloudflare|notion|zoom|calendly|dropbox|docusign|hubspot|stripe|apollo|linkedin|atlassian|figma|canva|openai|anthropic|resend|namecheap|godaddy|squarespace|wix|microsoft|apple|amazon|aws|tiktok|facebook|instagram|x\.com|twitter|meta|eventbrite|zillow)\./;

export type RawMessage = {
  account: string; gmailMessageId: string; gmailThreadId: string; internalDate: string; from: string; to: string[]; cc: string[]; bcc: string[]; replyTo?: string | null;
  subject: string; snippet: string; body?: string | null; labels: string[]; attachments?: { id: string; filename: string; mimeType?: string; size?: number }[]; inReplyTo?: string | null; references?: string | null; displayUrl?: string | null;
};

/** Low-signal classification: labels, sender shape and wording. `basis` says why. */
export function classify(m: RawMessage, own: string[]): { mailClass: MailClass; basis: string } {
  const from = parseAddress(m.from);
  const local = from.email.split("@")[0], dom = domainOf(from.email);
  const subj = m.subject.toLowerCase(), text = `${m.subject} ${m.snippet}`.toLowerCase();
  const sent = own.includes(from.email);
  const ownDomains = new Set(own.map(domainOf));
  if (/^(invitation|accepted|declined|updated invitation|canceled event|cancelled event|tentatively accepted)\b/i.test(m.subject.trim())) return { mailClass: "calendar", basis: "calendar subject" };
  if (!sent && /^\[?\d+\s*(min|minute|hour|day)s?\s+reminder\]?|^confirmation of your upcoming (call|meeting)|^reminder:\s/i.test(m.subject.trim())) return { mailClass: "calendar", basis: "meeting reminder / confirmation" };
  if (!sent && /^welcome (to|gift)|verification code|c[oó]digo de verificaci[oó]n|verify your (email|account)|your sign-in link|password reset|order confirmation|need help completing your order/i.test(m.subject)) return { mailClass: "software_notification", basis: "account / onboarding notice" };
  if (!sent && ownDomains.has(dom) && SYSTEM_LOCAL.test(local)) return { mailClass: "internal_system", basis: `Regenera system sender ${from.email}` };
  if (!sent && dom.startsWith("mail.") && ownDomains.has(dom.slice(5))) return { mailClass: "internal_system", basis: "Regenera notification subdomain" };
  if (sent) {
    const external = [...m.to, ...m.cc].map(a => parseAddress(a).email).filter(e => !own.includes(e));
    if (!external.length) return { mailClass: "internal_system", basis: "sent to own addresses only" };
    return { mailClass: "substantive", basis: "sent by me" };
  }
  if (m.labels.includes("CATEGORY_PROMOTIONS")) return { mailClass: /webinar|event|conference|summit|register|tickets?/.test(text) ? "event_announcement" : "marketing", basis: "Gmail promotions category" };
  if (m.labels.includes("CATEGORY_SOCIAL")) return { mailClass: "software_notification", basis: "Gmail social category" };
  if (SOFTWARE_DOMAINS.test(`${dom}.`) || SOFTWARE_DOMAINS.test(dom)) return { mailClass: /tickets?|event|reminder for|order confirmation/.test(text) ? "event_announcement" : "software_notification", basis: `software / platform sender ${dom}` };
  if (SYSTEM_LOCAL.test(local)) {
    if (/webinar|event|conference|summit|register|registration|tickets?|join us/.test(text)) return { mailClass: "event_announcement", basis: `bulk sender ${local}@ with event wording` };
    if (/report|insight|outlook|research|analysis|brief/.test(subj)) return { mailClass: "research_update", basis: `bulk sender ${local}@ with research wording` };
    return { mailClass: "newsletter", basis: `bulk sender ${local}@` };
  }
  if (/unsubscribe|view (this|in) (email|browser)|manage (your )?preferences/.test((m.body ?? "").slice(-2500).toLowerCase())) return { mailClass: "newsletter", basis: "unsubscribe footer" };
  if (/\b(seo|web design|lead generation|book a (quick )?call|increase your sales|outsourc|our agency|we help companies|guest post)\b/.test(text)) return { mailClass: "vendor_sales_pitch", basis: "vendor pitch wording" };
  if (/\b(press release|media kit|podcast guest|feature you|interview opportunity)\b/.test(text)) return { mailClass: "media_pr_pitch", basis: "PR wording" };
  return { mailClass: "substantive", basis: "person-to-person mail" };
}

/** Subject and body template for campaign detection: names, numbers and greetings normalized away. */
export function templateOf(subject: string, body: string) {
  const s = subject.replace(/^(re|fwd?|fw):\s*/gi, "").toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
  const b = body.replace(/^(hi|hello|dear|good (morning|afternoon)|hola)\s+[^,\n]{1,40},?/i, "").toLowerCase().replace(/\d+/g, "#").replace(/[^a-z# ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
  return { subject: s, key: `${s}|${b}` };
}
export function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); }

/** Body without quoted history (so a reply does not re-count earlier messages). */
export function newText(body: string) {
  const cut = body.search(/\n(On .{5,120} wrote:|El .{5,120} escribió:|-{2,} ?Forwarded message|From: .+\nSent: |>)/);
  return (cut > 0 ? body.slice(0, cut) : body).trim();
}

export const SIGNALS = {
  introduction: /\b(i'?d like to introduce|let me introduce|looping (you |yall |y'all )?in|happy to connect you|you should (speak|talk) (with|to)|meet [A-Z][a-z]+|introducing you|cc'?ing|copying in)\b/i,
  ndaRequested: /\b(nda|non-disclosure|confidentiality agreement)\b/i,
  ndaExecuted: /\b(signed|executed|countersigned|attached the signed) (the )?(nda|non-disclosure)/i,
  meeting: /\b(meet\.google\.com|zoom\.us\/j|teams\.microsoft|calendly\.com|let'?s (schedule|set up) a (call|meeting)|great (speaking|talking|meeting)|nice to meet)\b/i,
  materialsRequested: /\b(send (me|us|over) (the )?(deck|model|teaser|im|memo|financials|data ?room)|could you (share|send)|please (share|send))\b/i,
  proposal: /\b(proposal|term sheet|loi|letter of intent|engagement letter)\b/i,
  declined: /\b(not (a fit|interested|for us)|pass on this|we('ll| will) pass|no longer interested|unsubscribe me|remove me)\b/i,
};

/** Evidence → engagement state (the furthest supported step) and relationship stage; strength kept separate. */
export function engagement(e: { sent: number; received: number; replies: number; meetings: number; materialsShared: number; materialsRequested: number; ndaRequested: boolean; ndaExecuted: boolean; proposal: boolean; declined: boolean; lastAt: string | null; now: string; campaign: boolean; inbound: boolean }) {
  let state: EngagementState = "identified";
  if (e.campaign || e.sent) state = "cold_emailed";
  if (e.sent >= 2 && !e.replies) state = "followed_up";
  if (e.replies || (e.inbound && e.received)) state = "replied";
  if (e.materialsRequested) state = "materials_requested";
  if (e.materialsShared && (e.replies || e.received)) state = "materials_shared";
  if (e.meetings) state = "meeting_held";
  if (e.ndaRequested) state = "nda_requested";
  if (e.ndaExecuted) state = "nda_executed";
  if (e.proposal) state = e.received ? "proposal_received" : "proposal_sent";
  if (e.declined) state = "declined";
  const days = e.lastAt ? (Date.parse(e.now) - Date.parse(e.lastAt)) / 86_400_000 : 9999;
  if (days > 270 && !["declined", "closed"].includes(state) && state !== "identified") state = "dormant";
  const stage: RelationshipStage = e.ndaExecuted || e.proposal ? "qualified" : e.meetings || (e.replies && e.materialsShared) ? "engaged" : e.replies || (e.inbound && e.received) ? "engaged" : e.sent ? "contacted" : "target";
  // §30 strength: a substantive reply or meeting outweighs volume; never from message count alone.
  const score = e.meetings * 3 + (e.ndaExecuted ? 3 : 0) + (e.proposal ? 2 : 0) + Math.min(e.replies, 4) + (e.materialsShared ? 1 : 0);
  const strength = score >= 6 ? "strong" : score >= 3 ? "moderate" : score >= 1 ? "weak" : "none";
  const responseQuality = e.replies >= 3 || e.meetings ? "substantive" : e.replies ? "brief" : "none";
  return { state, stage, strength, responseQuality };
}
