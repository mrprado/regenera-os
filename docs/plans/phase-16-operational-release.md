# Phase 16: operational release (2026-10-02)

Source: `claude-code-regenera-os-release-brief-2026-10-02.md` and `regenera-os-verified-update-review-2026-10-02.md`.
Branch `fix/origination-economics-and-geography`, from `main` at `36bb3c6`. Migrations are additive (0049).

This release repairs the shared engines; it does not add a second CRM, scanner, claims system or mandate model.

## What changed, by workflow

### Discovery and scan configuration (P0)

| Problem found | Fix | Files |
|---|---|---|
| Preset save dropped mode, objective, sector, titles, seniorities, headcount, capabilities, size, stages, freshness, budgets | Full form ↔ config module; every supported field round-trips (tested save → reload → parse) | `lib/scan/preset-form.ts`, `app/(app)/scans/preset-form.tsx`, `app/(app)/scan-actions.ts` |
| Over-long text silently became "" | Named errors with the limit; nothing saved; the form keeps what was typed | same |
| Geography split on spaces ("United States" → two entries); ~60 countries | All 250 ISO 3166-1 entries, aliases (US/UK/UAE/KSA, formal and local names, accents), GCC as a group inside MENA, searchable picker; unknown entries refused | `lib/scan/countries.ts` |
| Unrecognized recorded country excluded a match | Unknown, needs review | `lib/scan/criteria.ts` |
| Workspace re-screen used up the discovery allowance before external sources ran | Separate bounds: `maxOrganizations` is new external discovery; re-screen has its own equal bound and is counted as "re-screened", never "new" | `lib/scan/engine.ts` |
| Provider "ok" without calls; no per-source results | Per source: calls, returned, kept, excluded, duplicates, created, already held, last error; uncalled = skipped with the reason | `db/scans.ts` (JSON), engine, run page |
| Any active scan of the same audience was reused | Reuse only the same section + objective + config fingerprint; explicit "run fresh"; max 3 concurrent scans | engine, launch page |
| Opportunity preset could run organization discovery | Mode/source validation refuses mismatches | `lib/scan/config.ts` `configProblems` |
| Settings with no effect (enrichment budget, flag-only dedupe, optional review) | Stated as fixed behaviour, not offered | form |
| Query terms invisible | Preflight and run page show terms sent, exclusions, freshness, coverage | `lib/scan/web.ts` `queryTerms` |

Open-web briefs now use sector, freshness and local-language search, and say whether an item is a tender, announcement or queue entry.

### Operational health (P0)

- **Schedules:** each one shows last queued, last completed and last failure with its error. Queued is never shown as working; a job put back after an expired lease is not a failure. (`lib/jobs/health.ts`, Settings → Jobs)
- **Queue:** shows what is due and waiting with its age, plus running, retrying, dead and expired leases. Leases are reclaimed by the tick, as before.
- **Readiness:** Claude and Apollo read **Configured, not verified** until a call succeeds, and **Failing** when the newest call failed. Backups show stale after 2 days, and partial scans need attention. (`lib/readiness.ts`)
- **Time:** times are displayed in Pacific (`lib/time/zone.ts` `fmtLocal`); storage stays UTC.

### Commercial offers and economics (P0)

- **Migration 0049:**
  - Mandates gain pilot days and dates, a retainer status (none, proposed, approved, active or declined) with approver, and a target margin (default 55%).
  - Engagements gain a price-override reason, approver and time.
  - Existing retainers on active mandates stay counted; all others become *proposed*.
- **Pilot:** a fixed fee over its days. If no length is recorded, 45 days is assumed and labelled. It is never recurring revenue.
- **Retainer:** counted only once separately approved (by a workspace owner, recorded) or active. A blank term is "not agreed", never 12 months. Desk MRR follows the same rule.
- **Target margin:**
  - Every pilot and retainer shows its maximum cost at the target margin and a below-target warning.
  - Check: a $12,500 pilot at 157.5 h × $75 contributes $687.50 against a $5,625 cost ceiling, so it is flagged below target.
  - A $15k/month retainer has a $6,750 cost ceiling.
- **Named cost bases** (`lib/commercial/vocab.ts` `COST_BASIS`):
  - Catalogue pricing assumption: $120/h.
  - Mandate planning default: $75/h, used only for unassigned seats.
  - Assigned team rates always win.
- **Delivery:** draft, proposed or not-yet-started mandates are **pre-launch**: reviewed but never scored "short". The existing EMC review is displayed as a pre-launch operating review.
- **Engagements:**
  - A fee below the services' floor needs an owner's written reason (audited), and contracting is blocked without it.
  - Planned or logged time with no internal cost rate makes the margin **unknown**, never inflated.
  - Floors round up to the next $500 after cents (`9000 / 0.45` stays 20,000).

### Founder Command (P1)

- **Hero:** the exact approved copy on a white canvas, with a short copper rule and a restrained gold focus.
- **Horizontal map (200 px), with three modes:**
  - **New alerts:** records created since the start of the local Pacific day. Funding calls are listed as coverage areas, never pinned.
  - **Today's work:** the records behind overdue and today's items.
  - **All records.**
  - Hide/show and Open Atlas.
  - Unmapped items are listed.
  - Capital is marked as an office location, never proof of deployment geography.
  - Test records are excluded.
- **Needs your decision:** up to three items from real overdue, due-today or blocked work, each with reason, basis, date, owner and one action. Then pending Ask/Claude proposals.
- **Four shortcuts:** explore opportunities (`/scans`), review projects (`/projects`), structure engagements (`/commercial`), coordinate delivery (`/tasks`).
- **Outcomes & evidence:** counts from the existing claims table: verified by a person, awaiting evidence or verification, disputed. No impact numbers are generated; with no claims it says "unassessed is not zero impact".
- **Recent changes:** three, with a link to the full history.
- **Full desk:** every previous Command section (metrics, all priorities, conversations, opportunities, delivery, pipeline, readiness, what changed) is kept below in an expandable section. No function or nav route was removed.

## Remaining blockers and limits (not done in this release)

| Item | Effect | To resolve |
|---|---|---|
| Not deployed | The live site still runs the previous release, without 0049 and these fixes | Wrangler's login on this PC is broken (a second `C:\Users\KM\.wrangler` folder took precedence, and its token fails). Run `npx wrangler login`, then `npm run deploy` (builds, applies 0049, deploys). |
| No signed-in browser walkthrough | The pages are verified by typecheck, unit and integration tests and the production build, not by a signed-in screen check | Sign in at os.regenera.bio after the deploy and run the quick-start below |
| Real external discovery run | Tested with a mocked GLEIF source only; open web and Apollo spend real budget | Run one preset with a small research budget ($1–3) and check the run page tallies |
| Ten-prospect queue, outreach approval loop, project-stage checklists, capital eligibility screening, Ask scan-launch proposals, portal work queues, isolated backup restore | Existing engines are unchanged; not re-verified in this release | Next phase. Backup restore: `node scripts/restore-backup.mjs <folder>` into a separate local D1 |
| Engagement ↔ commercial-mandate ↔ invoice canonical link, contracted vs invoiced vs collected per mandate | Engagement economics already separate contract value, invoiced and collected; mandates do not yet roll up invoices | Next phase |
| RA-ESG duplicate drafts | Not touched (no merge without confirming equivalence) | Review both, then archive one with a recorded reason |
| Apollo | Key set; "configured, not verified" until a search succeeds | Run a scan that includes Apollo |

## Founder quick-start

1. **Scans → Presets.** Save a preset: mode, audience, geography (type to search, e.g. "GCC", "Namibia"), terms, sources, allowance and research budget. Reload it to confirm every field stayed.
2. **Run a scan.** Read the preflight: terms sent, countries, which sources will search and which only re-screen, the budget. Start it.
3. **Open the run.** Check each source's returned/kept/new/already-held counts. Accept or reject results with a reason.
4. **Open an accepted organization → Qualification.** Record fit, intent, access and contact readiness from evidence, then set *Ready for outreach* with a reason.
5. **Draft outreach from the sequence or queue.** It enters the approval queue; nothing sends until you approve.
6. **Log the reply or meeting on the same opportunity** (meeting notes → proposed actions you confirm).
7. **Scope the engagement in Commercial.**
   - Use the services and the pilot fee; a fee below the floor needs your reason.
   - Record the retainer as *proposed* until it is separately agreed.
8. **On the mandate profile, set pilot days and dates and the target margin.**
   - Check the Economics tab for below-target warnings before sending.
   - Activate only after agreement.
9. **Delivery.**
   - Active milestones and tasks appear on Command (*Today's work*).
   - Delivery is scored only after activation.

## First-day queue

Drawn from live records after the deploy, under Command → Needs your decision and Scans → Runs. The examples in the Command design reference (Saudi fund, Brazil project) are illustrative and were not created. Researched accounts saved earlier (DEI, PowerBank, Revolve) are manually researched records, not qualified leads. No number of qualified prospects or clients is promised.

## Workflow map (canonical entities)

```
scan_presets → scan_runs → scan_results → organizations + account_qualifications
  (discovered → criteria matched → human reviewed → ready for outreach)
  → sequences/messages (approval) → replies/meetings → deals (opportunity, commercial qualification)
  → engagements (services, fee floor, approval, conflict check) ↔ commercial_mandates (pilot, retainer status, delivery floor)
  → tasks/milestones (delivery) → invoices/payments → claims/evidence (outcomes, human verification)
```
