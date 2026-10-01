# Phase 13: Gmail historical intelligence (read-only)

Spec: `Regenera_OS_Gmail_Historical_Intelligence_Import_Spec.md` (user, 2026-09-30).

## What exists
- **Store** `db/mail-intel.ts` (migration 0045): sources, ingestion runs, checkpoints, messages (immutable source layer; body ≤ 20k chars, no HTML), threads, people, campaigns + recipients, facts (explicit / derived / hypothesis, supersession), obligations (commitments / requests), introductions, attachments (metadata only), review items.
- **Engine** `lib/mail-intel/classify.ts` + `engine.ts`: idempotent ingest on `account:gmailMessageId`; window and Spam/Trash exclusion; classification with a stated basis; `rebuild` re-derives everything from stored messages (reclassification, repeated unsolicited senders → marketing, campaigns of ≥ 3 recipients sharing a template, relationship strength separate from commercial stage, conservative CRM promotion, thread state, owed replies only inside an exchange, timeline activities); `applyExtraction` (§27 shape).
- **Import** `app/api/mail-intel/import/route.ts` (bearer `MAIL_IMPORT_TOKEN`, else `JOBS_TICK_TOKEN` outside production) and `scripts/mail-import.mjs <dir>` (resumable, never prints the token).
- **UI** `/intelligence/mail` (owner only): overview + sync status, threads, people, commitments & requests, introductions, documents, facts, campaigns, review queue. Today shows replies owed and open obligations.

## Run log (2026-09-30)
Mailbox connected through the Gmail connector: **alanprado@regenera.bio** (aliases prado@, aprado@; own alanprado.de@gmail.com), not alan@8608capitalinvestments.com. 305 messages / 260 threads / 69 people; 40 contacts and organizations promoted; 7 key threads extracted (Generation Forest Invest, Peter Henry / Matamba, Charlie Foxtrot partnership interest, Mérida six-homes listing, RA-ESG introducer terms, Proximo Capital intake). Bulk senders filtered from the search queries are a documented exclusion (Regenera system mail, Ansarada, TikTok, Slack, Google, Eventbrite and similar).

## Rules
Gmail is never modified (read tools only: search_threads, get_thread, get_message, list_labels). No passwords; gmail.readonly only for the future OAuth transport. Mobile numbers are never extracted. Mail never reaches Ask, MCP or global search.

## Next
Production transport: OAuth `gmail.readonly` + a `mail.backfill` job with checkpoints for the 8608 account; Claude extraction job for the remaining substantive threads with review of financial facts.
