# Phase 3 plan: Radar and reach

**Status: built Sep 24, 2026 (approved the same day, build report at the end).** Phase 1 already built the trigger engine: scanners, classification, decision reads, the Triggers feed and the Map. Phase 3 covers what that engine does not: turning triggers into sequences, saved searches, list diffs, the LinkedIn extension, Partners and Reports.

**Goal (SPEC section 15).** Triggers arrive daily and convert into sequences.

**Acceptance (SPEC section 26, phase 3):**
- The trigger scan creates triggers from live searches, with decision reads.
- Feed actions work.
- The extension captures a profile and logs "mark sent".
- Partner Network referral creation and status changes sync correctly.
- Reports render.

## Defaults (change any of them by telling me)

| Decision | Default |
|---|---|
| Trigger to outreach | "Pursue" on a trigger runs a free Apollo people search at that organization, using the trigger's suggested titles. You pick the people. They are saved, enriched only if you choose, and enrolled in the targeted sequence. Credits are spent only on people you select |
| Saved searches | Apollo filter sets per segment (already seeded) become runnable saved searches, each with a cadence. A run shows only people and companies not already in the CRM. Search costs 0 credits |
| Google X-ray and Sales Navigator Booleans | Stored as saved queries that open in your own browser, with one click to copy. Google's search API is closed to new customers, and scraping Google or LinkedIn is off the table |
| Public list diffs | Monthly. Each run compares against last month and adds new entries as organizations, with source `mandate_match` or `compliance`. Only lists that publish a downloadable file or open data are used (see below). Any list that needs a login or scraping against its terms is dropped |
| LinkedIn extension | Manifest V3. Runs only on `linkedin.com/in/*` when you click it. No background activity and no automated clicks. You load it unpacked, with no Chrome Web Store listing |
| Partners | Synced from the regenera.bio Partner Network: accounts, referrals, tiers and status. Password fields never leave the site |
| Weekly report | Mondays at 07:30 ET via Resend, and saved in Reports |

## Build

1. **Trigger to sequence ("Pursue"):**
   - A side panel on each trigger shows Apollo people at that organization (free search), filtered by the trigger's suggested titles and seniority.
   - A conflict check runs first: existing relationships, open deals, Partner Network referrals and other mandates. Matches are flagged, never auto-sent.
   - Selected people are saved and linked to the trigger, then enrolled in the targeted sequence. The draft opens from the trigger's decision read.
   - The trigger's status moves to `pursued`. Time from trigger to first touch is recorded for Reports.
2. **Saved searches:**
   - A `saved_searches` table covers segment, kind (apollo_people, apollo_orgs, xray, salesnav), filters or query string, region, cadence and owner.
   - Due Apollo searches run as a job and store "new since last run" results in a review list on People or Companies, marked "New from saved search".
   - X-ray and Sales Navigator entries are link-outs only.
   - The default searches from SPEC section 5 are seeded.
3. **Public list diffs.** A `list_sources` table with a snapshot per run. Candidates, each checked for current format and terms at build time:
   - SBTi target dashboard (downloadable file)
   - PRI signatory directory (public export)
   - TNFD adopters (public list)
   - CDP A List (public)
   - ImpactAssets 50 (public)
   - Dropped unless an open file exists: B Corp directory, GIIN members (login).

   New entries are matched to segments and become organizations, which then get the usual identity enrichment and geocoding.
4. **LinkedIn extension (`extension/`, MV3):**
   - **Capture:** sends the visible profile name, headline, location, current role and URL to `/api/webhooks/extension`. It matches by LinkedIn URL, then by name plus organization, and otherwise creates the contact.
   - **Side panel:** shows that contact's queued LinkedIn draft with a Copy button, plus "Mark sent", which completes the task and advances the sequence.
   - **Auth:** a per-user token issued and revoked in Settings, sent in a header and checked by `verifyExtensionToken` (already expected by the route-guard test).
5. **Partner Network sync:**
   - **Site, `os-integration` branch only, still unpublished:** a `partners` export kind (accounts without password fields), and a referral export that includes status changes (full scan, since the table is small).
   - **OS:** partners are upserted with tier, and referral status changes move the linked deal: scoped moves to engaged, mandate_signed to signed, and declined to lost with its reason. Partner-sourced deals feed the access axis of scoring.
6. **Partners screen:**
   - A list with tier, geography, capability, referral counts and conversion, and fees earned by tier (10, 15 and 20%).
   - Partner prospects from the channel segments are shown alongside, as candidates to invite.
7. **Reports (SPEC section 14):**
   - Reply and positive-reply rate by segment, funnel, trigger type, angle and tier.
   - Scoping calls per 100 contacts.
   - Win rate by engagement.
   - Time from trigger to first touch.
   - Pipeline value and weighted forecast by stage, practice and fee type.
   - Partner referral conversion.
   - Deliverability by domain.
   - Filters by date range and mandate. CSV export for each table.
8. **Weekly report.** Claude (Sonnet) writes one page from the week's numbers: pipeline movement, wins, stalled deals, best and worst angles, triggers worth attention and three recommended actions. It is stored, shown in Reports and emailed via Resend.

## Tests

- **Conflict check:** each match type flags and never enrolls.
- **Pursue flow:** a fake Apollo search, then save, then enroll, and the trigger moves to pursued.
- **Saved searches:** a run returns only records not already in the CRM, and re-runs are idempotent.
- **List diff:** the second snapshot yields only new entries, and removed entries are ignored.
- **Extension webhook:** a bad or revoked token is rejected. Capture matches by URL, then by name and organization, and otherwise creates. Mark sent advances the step once, even if repeated.
- **Referral sync:** create, then each status change moves the deal forward only. The partner export never includes password fields.
- **Reports:** rates, forecast and time-to-first-touch on seeded data.
- **Weekly report:** the output validates against its schema (fake model).

## What I need from you

- Approval of this plan, or changes to the defaults above.
- Confirmation that loading the extension unpacked in Chrome, with no Web Store listing, is fine.

## Build report (Sep 24, 2026)

**Built and tested locally.** 131 tests pass across 22 files. Lint, typecheck and build are clean. Migration 0003 is applied to the local D1. The extension itself has not been loaded in Chrome yet; its webhook was exercised directly (bad token rejected, capture matched the existing contact and returned the queued note).

**Pursue:**
- Built `lib/triggers/pursue.ts`, `lib/crm/conflicts.ts` and `lib/crm/contact-email.ts`, plus the page `/triggers/[id]`.
- The free Apollo search uses the trigger's suggested titles first, then falls back to decision-maker seniority.
- Addresses come from Apollo only when ticked (1 credit each). Otherwise they are inferred free from the organization's known pattern plus an MX check, with status "inferred".
- Blocking conflicts save the people but do not enroll them, unless overridden.

**Saved searches:**
- Built `lib/radar/saved-searches.ts`, plus the `/searches` page (sidebar, under Prospect).
- One weekly Apollo people search per enabled segment (0 credits), spread over weekdays, with 3 per hourly run to stay inside the free limits. Results are reviewed, then saved or dismissed.
- 7 Google X-ray and 7 Sales Navigator queries are link-outs.

**Public lists (`lib/radar/lists.ts`):**
- Checked live on Sep 24, 2026:
  - SBTi companies file (xlsx), read as a stream so the 15 MB sheet is never held in memory. 15,703 companies, 2,686 in scope, parsed in about 2 seconds. In-scope means Corporate and Financial Institution entries in land, energy, water, waste, food, forestry, real estate, construction and finance sectors (SMEs out).
  - TNFD adopters public table: 812 adopters, 425 in scope.
- The first local run created 100 organizations: SBTi entries updated in the last 60 days. TNFD has no update dates, so its first run is a baseline only.
- **Dropped, with reasons:**
  - PRI directory: loads through Salesforce's page API and offers no file.
  - ImpactAssets 50: behind a login.
  - CDP A List: not published as a file.
  - B Corp and GIIN: no open file.
- Only in-scope entries are stored, and inserts stay under D1's 100-parameter limit.

**LinkedIn extension:**
- Code:
  - `extension/`: Manifest V3 with a side panel.
  - `lib/extension.ts` and `/api/webhooks/extension`.
  - Settings → Extension: tokens shown once, stored as SHA-256 hashes, revocable.
- The page is read only when "Read this profile" is clicked, and the fields stay editable before saving.
- "Mark sent" uses the same `completeTask` as the Tasks screen, so a repeated click advances the step only once.

**Partner Network:**
- **Site, branch `os-integration` commit b2b25ad, still unpublished:** a `partners` export (never password fields) and `referrals?all=1`.
- **OS:**
  - Partners carry the site account id, organization, tier and status.
  - Referral deals link to the partner.
  - Status changes move deals forward only: scoped to engaged, mandate_signed and paid to signed. Declined closes the deal as lost.
  - Unchanged replays (the hourly full reconcile) are no-ops.
- **Partners screen:** tier totals with fees owed at 10, 15 and 20% of won value, plus channel-segment candidates to invite.

**Reports:**
- `lib/reports/metrics.ts` and `/reports`:
  - Reply and positive rates by segment, funnel, trigger type, angle, tier and language.
  - Scoping calls per 100 people.
  - Pipeline by stage, practice and fee type, weighted by probability or a stage default.
  - Win rate by engagement.
  - Trigger-to-first-touch median.
  - Partner conversion and deliverability.
- CSV download per table.
- **Weekly report** (`lib/reports/weekly.ts`, prompt `weekly.report`): Mondays at 07:30 ET. Numbers are always stored. Claude's one-page narrative is added once `ANTHROPIC_API_KEY` exists, and it is emailed via Resend when configured.

**Jobs:**
- `searches.run` hourly.
- `lists.diff` monthly on the 2nd at 05:00 ET, one job per source.
- `reports.weekly` Mondays at 07:30 ET.

**Fixed while building:**
- Free email inference could have created a duplicate contact. It now writes the address onto the exact record.
- The referral handler logged an activity on every call. It now acts only on a real status or tier change.

**Needed to go live:** nothing new beyond phase 2's list, plus publishing the site's `os-integration` branch for the partner export.
