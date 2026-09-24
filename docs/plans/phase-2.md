# Phase 2 plan: Automation

**Status: built Sep 24, 2026 (build report at the end). Started at Prado's request ("start phase 2"), with the defaults below.** Phase 1 go-live keys are still pending; phase 2 is built and tested locally the same way.

**Goal (SPEC section 15).** A sequence runs for two weeks with only queue approvals. **Acceptance (SPEC section 26, phase 2):**
- A test sequence runs end to end on test contacts: drafts, approval, scheduled sends inside send windows, follow-ups in the same thread.
- A reply of each class routes correctly and pauses the organization.
- A calendar event moves the deal to call_booked.
- The digest arrives.
- No duplicate sends under concurrent sender runs.

## Defaults (change any of them in Settings or by telling me)

| Decision | Default |
|---|---|
| Send windows | Recipient local time, Tuesday to Thursday 08:30–11:30 and 14:00–16:30. Monday and Friday 09:30–11:30 only. No weekends |
| Recipient time zone | Contact time zone if known, else from country (a table of about 80 countries), else America/New_York |
| Warm-up ramp (secondary domain) | Day 1: 10 sends. +3 per day to a 40 per day cap. The primary mailbox cap is 25 per day |
| Auto-pause | Bounce rate above 3% (last 7 days, minimum 20 sends) or any spam complaint pauses that mailbox |
| Mass-tier sender | Secondary sending domain. Targeted tier and all replies go from regenera.bio |
| Follow-ups | Same Gmail thread (threadId + In-Reply-To + References) |
| Drafting model | Claude Sonnet 5 (`draft.sequence`). Reply classification: Claude Haiku 4.5 (`reply.classify`) |
| Digest | 07:00 ET to alanprado@regenera.bio via Resend |
| LinkedIn steps | Assisted only: the OS drafts the note and creates a task. You send it on LinkedIn and mark it done. No automation |

## Build

1. **Schema (migration 0002):**
   - New tables: `sequences`, `enrollments`, `replies`, `tasks`, `mailbox_state` (daily counts, pause), `relationships` (Gmail and Calendar metadata) and `deliverability_checks`.
   - New columns on `messages`: enrollment, step, `scheduled_at`, tier, `angle_tag`, `variant_id` and `rfc_message_id`.
2. **Default sequences** (SPEC section 8), seeded:
   - Mass: email D0, LinkedIn D2, email D5, email D12, breakup D21.
   - Targeted: LinkedIn D0, email D2, LinkedIn D5, email D12, personal note D21.
3. **Enrollment:** a bulk action from People or a List. Enrollment refuses:
   - investment-mandate contacts, which are also blocked from auto follow-ups
   - suppressed contacts
   - a second active enrollment for the same person
   - mass tier without a verified email
4. **Drafting:** `draft.sequence` writes every step from the dossier and match. Each draft goes through the house-style validator, which retries once, then lands in the approval queue.
5. **Approval queue:**
   - Drafts are grouped by tier and segment, with the dossier panel beside each draft.
   - Keyboard shortcuts: A approves, E edits, R regenerates the angle, S skips, arrow keys move between drafts.
   - Bulk approve is available for the mass tier only.
   - Approved follow-ups on advisory sequences don't need re-approval (SPEC section 8).
6. **Sender (every tick):**
   - Claims due approved messages inside the recipient's window and under the mailbox cap, using the atomic claim with its suppression check.
   - Threads follow-ups in the same conversation.
   - Mass-tier email carries a signed unsubscribe link, a one-click `List-Unsubscribe` header and the postal footer.
   - A 60-second undo window after approval.
7. **Unsubscribe:** `GET /api/unsubscribe/[token]` (signed, anonymous) suppresses the address and confirms on a plain page.
8. **Reply watcher (every 10 min):**
   - Reads the Gmail history since the last `historyId` and matches replies by thread, then by sender.
   - Haiku classifies each reply, and routing follows SPEC section 10.
   - Any reply stops every enrollment at that organization.
9. **Inbox:** threads with their classification, the dossier beside them and a suggested reply (`reply.respond`, Sonnet). Sending a reply uses the guarded send.
10. **Calendar sync (every 30 min):**
    - Attendees are matched to contacts, and each meeting is logged as an activity.
    - The deal moves to call_booked.
    - A `meeting.brief` is written 24 hours before the meeting.
11. **Tasks:** LinkedIn steps (draft plus a link to the profile), follow-ups and next actions due. Marking a task done advances the sequence.
12. **Daily digest:** 07:00 ET via Resend. It covers new triggers, queue size, replies to handle, meetings today and overdue next actions.
13. **Deliverability monitor (daily):** SPF, DKIM, DMARC and MX over DNS-over-HTTPS for both domains, plus bounce and complaint rates. It alerts on Home and in the digest.
14. **Relationship intelligence:**
    - Reads Gmail and Calendar metadata only (addresses and dates, never bodies) for the last 12 months.
    - Builds warm paths per organization, which feed the access axis of scoring.
15. **Sequences screen:** steps, audiences, per-step and per-angle stats, pause and resume.

## Tests

- Window and time-zone math across DST, and the warm-up caps and auto-pause.
- Enrollment guards, and the drafting-validator loop with a fake model.
- Approval rules: bulk approve is mass-only.
- Sender: exactly one send under concurrency, the window and cap respected, thread headers, unsubscribe headers and token signing.
- Reply routing for every class, with fake Gmail and a fake model.
- Calendar match leading to the stage move, the digest content, the DNS checks, and the relationship aggregation.

## Build report (Sep 24, 2026)

**Built and tested locally.** 112 tests pass across 20 files. Lint, typecheck and build are clean. Migration 0002 is applied to the local D1.

**Code:**
- `lib/outreach/`: sequences.ts, sender.ts, unsubscribe.ts, replies.ts, calendar.ts, relationships.ts, deliverability.ts, digest.ts and queries.ts.
- `lib/crm/deals.ts`: moves deals forward only, never backward.
- Server actions: `app/(app)/outreach-actions.ts`.
- Pages: `/queue`, `/sequences`, `/tasks`, `/inbox` and `/settings/sending`, plus the anonymous route `/api/unsubscribe/[token]`.
- Enroll controls on People (bulk) and Lists (whole list).
- Home shows drafts to approve, replies to handle, tasks due, meetings with their briefs, and sending alerts.
- Scoring reads warm paths from relationship metadata for the access axis.

**Jobs (seeded schedules):**
- `outreach.send` every 5 minutes
- `replies.watch` every 10 minutes
- `calendar.sync` every 30 minutes
- `relationships.sync` hourly
- `deliverability.check` daily at 06:00 ET
- `digest.daily` daily at 07:00 ET

Drafting, reply classification, reply suggestions and meeting briefs are queued jobs. They defer without an Anthropic key and never fail.

**Decisions made while building:**
- **Spacing.** Follow-ups keep their day gaps from the previous actual send, with 12 hours of slack. A late first email pushes the whole sequence back instead of sending two in one day.
- **Unsubscribe.** GET shows a confirm button. POST, or a mail client's one-click request, applies it. Link scanners can't unsubscribe anyone.
- **Mass tier.** Never sends without a configured unsubscribe secret.
- **Non-production.** Sequence email to any domain outside `SEND_ALLOWED_DOMAINS` is marked failed and never sent.
- **Out of office.** The sequence continues, shifted to the day after the return date. It is not treated as a reply.
- **Hostile and unsubscribe replies.** Gmail has no complaint feed, so these count as complaints for the auto-pause rule.
- **Bounces.** Detected from mailer-daemon mail without the model.
- **Reply matching.** Replies are stored only when they match a CRM contact, by thread first and then by sender. Other mail is never read into the OS.
- **Relationships.** Read From, To and Cc metadata only (no subjects or bodies). A 12-month backfill runs one 30-day window per hour.

**Found in live data:** the first deliverability check of regenera.bio found no SPF record and no Google DKIM key (selector `google`), and DMARC at `p=none`. MX is Google. These need fixing in Cloudflare DNS before any sequence sends from regenera.bio:
- SPF: `v=spf1 include:_spf.google.com ~all`
- DKIM: generate in Google Admin (Apps, Gmail, Authenticate email) and publish the TXT record
- DMARC: move to `p=quarantine` once reports look clean

**Needed to go live:**
- Google OAuth for both mailboxes.
- `ANTHROPIC_API_KEY`.
- `UNSUBSCRIBE_SIGNING_SECRET`, `COMPANY_POSTAL_ADDRESS`, `SENDING_DOMAIN` and `SENDING_WARMUP_STARTED`.
- Resend variables for the digest.
- `APP_ENV=production` on the live OS only.
