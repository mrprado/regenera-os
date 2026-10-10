# Phase 25 — Pinned items in the header

Status: **proposed 2026-10-10, awaiting approval.** Additive only: one new table, one header component, one pin button.
Stack, routes, permissions and existing records unchanged.

## 1. Why

The founder switches between the same few live items all day (a funding application, a project assessment, an analysis,
a prospect search). Today each switch takes several clicks through the sidebar and loses the current place. Pinned
items keep up to six of them one click away (docs/ux-laws.md: law 18 shortcuts for frequent actions, law 5 avoid
remembering between screens, law 11 resume interrupted work).

## 2. What the user sees

- **Pin button** on record pages: project, deal, funding call, funding application, analysis (workbench), scan run,
  saved search / objective, organization, person, capital partner, contract, mandate, pursuit. Label "Pin" / "Pinned",
  placed with the page's other header actions. Keyboard: `P` on a record page when focus is not in a field.
- **Header tray** between the breadcrumb and the notification bell: up to 6 pinned items as compact tabs, each with a
  type icon, a short name (ellipsis at 24 characters, full name on hover) and an × to unpin. The item for the page you
  are on is highlighted. When full, pinning a seventh asks which to replace (no silent drop).
- **Open**: a click opens the record in the right-side review drawer already used on Command (same guard, data, tabs and
  server actions; nothing duplicated). The arrow in the drawer, or Ctrl/Cmd-click on the tab, opens it full page.
- **Reorder** by drag, or by keyboard (focus a tab, Alt+← / Alt+→).
- **Narrow screens** (< 900 px): the tray collapses into a "Pinned (n)" menu beside the bell.
- **Empty state**: no tray is shown until the first pin; the first time, a one-line hint under the Pin button.

## 3. Data and rules

- Table `pinned_items` (migration 0058, additive): `id`, `user_email`, `mandate_id`, `entity_type` (enumerated: project,
  deal, funding_opportunity, funding_application, analysis, scan_run, objective, saved_search, organization, contact,
  capital_profile, contract, commercial_mandate, pursuit), `entity_id`, `label` (cached display name), `href`, `position`,
  `created_at`. Unique on (user_email, entity_type, entity_id). At most 6 rows per user (enforced in the action).
- **Private to the user**: never shown to others, never sent to Ask, MCP or search.
- **Permission at read time**: the tray re-checks each pin against the user's current workspace scope (mandateCondition)
  and module entitlement (pathAllowed). A pin to a record the user can no longer open is hidden and removed; an archived
  or deleted record disappears from the tray with a one-time "1 pinned item is no longer available" note.
- Owner-only records (private capital profiles, email intelligence) can be pinned only by owners, as today.
- Labels refresh when the record is renamed (the tray reads the current name; the cached label is a fallback).
- Server actions `pinAction`, `unpinAction`, `reorderPinsAction` through withOsUser; view-only users see no Pin button.
- Audit: pin and unpin are not audited (personal navigation, not a business record).

## 4. Build

1. `db/pins.ts` + migration 0058; `lib/pins/{vocab,queries}.ts` (entity registry: type → table, scope column, href,
   label column, module) so adding a record type is one line.
2. `components/pin-button.tsx` (server-action form, pending state from the form guard) added to the record pages listed.
3. `app/(app)/pinned-tray.tsx` (client) in the header slot; drawer reuse from components/command-review.tsx (extracted to
   a shared `RecordDrawer` so Command and the tray open records the same way).
4. Tests: scoping (another workspace's record never appears), entitlement filtering, 6-item limit and replace,
   uniqueness, removal of unavailable pins, label refresh; nav-inventory unaffected (no new page).

## 5. Acceptance

- Pin a project, a funding application and an analysis; switch between them from any page in one click, the drawer
  opening over the current page; reorder; unpin.
- A pinned record in a workspace the user loses access to disappears from the tray on next load.
- Phone width: pinned menu reachable beside the bell; no horizontal scroll.
- Typecheck, lint, full test suite and build pass; migration applies cleanly on deploy.
