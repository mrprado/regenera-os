# Regenera ecosystem: how the OS connects to regenera.bio, Google, LinkedIn and the rest (2026-10-06)

This document describes each external connection and the workflow it feeds: what is wired, where you see the result in the
OS, what it needs to work, and what is deliberately manual.

## Sidebar (founder order)

```
Command        Today: Inbox · Tasks · Approvals · Notifications
               Incoming: New leads (incl. regenera.bio) · Partner referrals · Portal messages · Portal intake
               Outreach: Approval queue
Atlas · Mandates
PIPELINE       Deals (incl. clients & engagements) · Network
Capital · Projects (incl. systems & disciplines)
WORKSPACE      Delivery · Intelligence
Settings       Connections · Integrations · Sending · Extension · Jobs …
```

## Connections

| Connection | What happens | Where you see it | Needs (names only) | Status |
|---|---|---|---|---|
| **regenera.bio enquiry forms** ("Discuss a project", "Share a capital mandate", partnerships) | A signed webhook creates the organization, the contact and a lead-stage Deal (project diagnostic or capital mandate path). Partnerships become partners. An hourly `site.reconcile` job catches anything the webhook missed. Idempotent per site record. | Command → Incoming → **New leads**; Deals → Engagement pathways | `SITE_WEBHOOK_SECRET` (same value on regenera.bio), `SITE_EXPORT_TOKEN`, `SITE_BASE_URL` | Code complete. **On production these two secrets were not set as of 2026-10-02, so website enquiries were not arriving.** Set both on the OS Worker and on the site. |
| **Referrals** (partner introductions) | Recorded with agreements and fees; attribution is fixed at introduction | Command → Incoming → **Partner referrals** | none | Wired |
| **Client / sponsor / investor portals** | External users see only granted records; messages, intake and requests come back to the OS | Command → Incoming → **Portal messages**, **Portal intake**; Delivery → Portal requests | none | Wired |
| **Gmail** (primary mailbox) | Reply watcher reads replies to OS-sent threads, classifies them and routes them to the inbox. Sending goes only through the approval queue, with caps, warm-up, threading and unsubscribe. Mail intelligence import is owner-only and read-only. | Command → Inbox; Command → Outreach → Approval queue | Google OAuth (`GOOGLE_CLIENT_ID/SECRET`, `TOKEN_ENCRYPTION_KEY`), SPF + DKIM on regenera.bio, `UNSUBSCRIBE_SIGNING_SECRET`, `COMPANY_POSTAL_ADDRESS` | Connected on production (alanprado@regenera.bio). **`COMPANY_POSTAL_ADDRESS` is needed before any outreach email can go out.** |
| **Google Calendar** | Meetings sync, briefs are prepared, and meeting notes become proposed actions you confirm | Command (meetings needing prep); the opportunity record | same OAuth | Read-only, wired |
| **Google Drive** | **New:** "Save to Drive" on any generated document saves the PDF into a *Regenera OS* folder in your Drive. Audited; nothing is shared. Uses the `drive.file` permission, which sees only files the OS created. | Documents → a generated document → Save to Drive | same OAuth (scope already granted) | New in this release; tested with a mocked Drive. Needs one live check after deploy. |
| **LinkedIn** | **Manual by design:** never scraped and no automated actions. The Chrome extension (Settings → Extension) captures a profile you are viewing into the CRM with its source. LinkedIn is a manual outreach channel; the OS records the touch. | Network → People; the touch is logged on the contact | `EXTENSION_TOKEN_SECRET`; load `extension/` unpacked in Chrome | Wired; manual by policy |
| **Apollo** | Company and people search in scans (search is free, enrichment is budgeted); no Apollo sequences or mailboxes | Network → Target & discover → Scans | `APOLLO_API_KEY`, `APOLLO_MONTHLY_CREDIT_BUDGET` | Key set; "configured, not verified" until a scan uses it |
| **Claude (Anthropic)** | Research, open-web discovery, drafting and meeting extraction, capped by the monthly budget and logged per call | Everywhere an AI draft or brief appears | `ANTHROPIC_API_KEY`, `AI_MONTHLY_BUDGET_USD` | Key set |
| **Claude ↔ OS (MCP)** | Claude can read the pipeline and propose actions (draft email, move deal, note); every write is a proposal you confirm | Command → proposals waiting for confirmation | per-user token at Delivery → API & MCP | Connected |
| **Resend** (mail.regenera.bio) | System notifications only (digests, alerts), never outreach | Your email | `RESEND_API_KEY`, `RESEND_FROM`, `NOTIFY_EMAIL` | **Not set on production as of 2026-10-02**: notifications are not emailed |
| **Booking link** | Inserted in outreach drafts when a meeting is proposed | Drafts | `BOOKING_URL` | Not set as of 2026-10-02 |
| **Background jobs** | Scans, funding scan, site reconcile, reply watcher, backups, digests | Delivery → Automation controls → Jobs | `JOBS_TICK_TOKEN` (set) | Running on production |
| **Backups** | Nightly D1 export to R2 at 02:30 Pacific; monthly read-back check | Settings → Jobs | R2 bucket `regenera-os-backups` | Running |
| **Data sources** (GLEIF, Grants.gov, EU F&T, UK Contracts Finder, OSM, NASA, WRI…) | Registry-gated public sources with caches and a call ledger | Intelligence; Atlas evidence layers | mostly keyless; `ESRI_API_KEY` optional | Wired |

## End-to-end workflows

1. **Website enquiry to client:**
   - regenera.bio form → New lead (Command → Incoming).
   - Qualify on the Deal: need, buyer, timing, budget path, next step.
   - Draft a reply from the approval queue (sent from Gmail after approval).
   - Meeting on Calendar → notes → proposed actions you confirm.
   - Proposal → Mandate/engagement (pilot fee; retainer recorded separately) → contract.
   - Deliverables and invoices in Deals → Clients & engagements.
   - Save the proposal or brief to Drive.
2. **Origination:**
   - Network → Scans (open web, GLEIF, Apollo) → review results → qualify.
   - LinkedIn profile captured with the extension → sequence → approval queue → Gmail → reply in Inbox → Deal.
3. **Project build:**
   - Projects → Atlas (select the project; grid, land, hazards, boundary) → site workbench.
   - Readiness, constraints and claims with evidence.
   - Capital readiness and matching.
   - Briefs and documents saved to Drive.
4. **Capital:** Capital → match (private profiles owner-only) → introductions (approval gated) → data room via portal → portal messages come back to Command → Incoming.

## What is still manual or missing

- **Production secrets to add** (via `npx wrangler secret put <NAME> --name regenera-os`):
  - `SITE_WEBHOOK_SECRET` and `SITE_EXPORT_TOKEN`: also set on regenera.bio.
  - `COMPANY_POSTAL_ADDRESS`
  - `RESEND_API_KEY`, `RESEND_FROM` and `NOTIFY_EMAIL`
  - `BOOKING_URL`
- **Drive** is export only (save documents). The OS does not import or watch Drive folders; attach files to records by upload.
- **LinkedIn** stays manual: no messaging, connection requests or scraping, by policy and by LinkedIn's terms.
- **Shared inboxes** (for example info@regenera.bio as a Google Group) are not read; replies are read from the connected primary mailbox only.
- **Not verified live in this release** (the demo blocks outbound calls): Drive upload, Gmail send and reply, the regenera.bio webhook. Verify each once after the next production deploy.
