# External portals and public intake

Master build instruction §02, §26, §31–38, §46, §61, §69, §93–94. One database and entity graph; external users are
a separate population with their own credentials, and they see only what an explicit grant names.

## Surfaces
| Surface | Route | Who | Guard |
|---|---|---|---|
| Internal OS | `/os/*` (app group) | Regenera members | `requireOsUser` / `withOsUser` (OS session) |
| Sponsor portal | `/os/portal/sponsor` | Project sponsors | `requirePortalUser("sponsor")` |
| Capital portal | `/os/portal/capital` | Capital partners | `requirePortalUser("capital")` |
| Introducer portal | `/os/portal/broker` | Brokers / introducers | `requirePortalUser("broker")` |
| Partner portal | `/os/portal/partner` | EPCs, engineers, consultants | `requirePortalUser("partner")` |
| Stakeholder portal | `/os/portal/stakeholder` | Landowners, agencies … | feature flag `PORTAL_STAKEHOLDER=on` |
| Public intake | `/os/intake/{project,capital,broker,partner}` | Anyone | honeypot, per-IP rate limit (5/hour), zod validation |
| Admin | `/os/portals` | Regenera members (approvals owner-only) | `requireOsUser` |

## Accounts
- `portal_users` (email unique across portals, one kind per email), `portal_invites` (single-use, 14 days),
  `portal_sessions` (14 days, revocable). Passwords: PBKDF2-SHA256, 100,000 iterations, 16-byte salt; minimum 12
  characters with a letter and a digit.
- Invitations are links shown once to the inviter (never emailed by the OS). Suspending or revoking ends every
  session. The `portal_session` cookie is separate from `os_session`; portal code never resolves the OS session
  (tested in tests/unit/route-guard.test.ts).

## Visibility (§46)
- `portal_grants`: one row per user × entity (project, capital opportunity, data room, document, procurement
  package), optional expiry and download right, revocable. Nothing is inferred from association.
- Every portal page reads through `lib/portal/views.ts`, which builds whitelisted shapes: no internal notes, no match
  reasoning, no investor identities for sponsors (counts only), no other bidders for partners.
- Documents are never linked directly. `/api/portal/doc/[id]` runs `canOpenDocument` (grant or open data room with
  accepted NDA → introducer standing → distribution approval for audience, jurisdiction, dates, and for
  securities-related material a verified licensed introducer or a verified investor qualification) and logs every
  decision in `portal_access_log` before redirecting to the document's https location.
- Capital opportunities are visible only when granted AND the compliance gate is Approved AND the opportunity is
  active; a grant never overrides the gate.

## Introducers (§31–34)
- `broker_profiles`: role type (a label, not authority to offer securities), jurisdictions, licence status
  (verified needs evidence), agreement status and expiry, compliance status (Applied → Under review → Approved /
  Restricted / Suspended / Expired). Access to deals and materials requires Approved + signed, unexpired agreement.
- `referral_registrations`: duplicate/existing-record, existing-relationship, competing-claim, jurisdiction,
  agreement-standing and role checks; anything found → Conflict review. Decisions (owner) set protection for 365 days.
  Registration never creates a fee entitlement.
- `referral_agreements` + `commission_schedules` (fixed, %, bps, milestone, custom; cap, minimum) +
  `commission_events`: amounts stay "Estimated / subject to agreement" until the schedule is approved, the agreement
  is active with legal review approved, and the registration is approved or converted.
- Daily job `portal.expire` expires agreements (removing access) and lapsed registrations.

## Data rooms (§26)
`data_rooms` (audience, status draft/open/closed, NDA required, NDA text and version), `data_room_documents` (13
folders), `nda_acceptances` (name, IP, version; a new version requires re-acceptance). Files live where they are
(Drive, data room links) until R2 is enabled; views and denials are logged per document.

## Requests, updates, messages
`document_requests` addressed to a portal user (respond with an https link and a note), `project_updates` visible
to the chosen audiences only after approval, `portal_messages` threads (replies are posted in the portal, not
emailed).

## Tests
tests/integration/portal.test.ts covers §93 and §94: unapproved and expired introducers, other introducers'
referrals and fees, commission approval blockers, securities-related material, jurisdiction and dates, capital vs
sponsor documents, NDA gate, qualification requirement, sponsor view without investor identities or internal notes,
partner sees only its own bid, expired grants, intake validation, rate limit and conversion.
