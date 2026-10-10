# Phase 26 — Dark mode (Settings → Appearance)

Status: **proposed 2026-10-10, awaiting approval.** Presentation only: no record, route, permission or data change
beyond one per-user preference.

## 1. What the user gets

- **Settings → Appearance** (new section, first in the Settings menu for everyone, clients included): Theme
  **Light · Dark · Match my device** (default: Light, today's look). Also in the avatar menu as a one-click toggle.
- The choice is saved to the user's account (follows them across devices) and applied before the first paint, so pages
  never flash light-then-dark.
- Atlas keeps its own map styles; its panels follow the theme. Printed pages and generated PDFs stay light.

## 2. Palette (from docs/design-system.md, not new colours)

| Token | Light (today) | Dark |
|---|---|---|
| Canvas `--bg` | #F6F7F3 | Carbon Moss #1B211D |
| Surfaces `--surface`, `--chalk` | #FFFFFF | Graphite Moss #252D27 |
| Raised / selected `--surface-selected` | #EAF0E5 | #2E3A32 |
| Hairlines `--line`, `--ash` | #E0E4DB | #3A463E |
| Text `--text-1 / -2 / -3` | #302F28 / #686357 / #777164 | Warm Ivory #F3F0E9 / #C9CFC5 / #9AA597 |
| Action (green buttons, active tabs) `--action` | #246448 | #3E8A64 (contrast 4.5:1 with ivory text) |
| Wordmark, selection rail `--gold` | #D5AB4A | Saffron Gold #D9A61C |
| Semantic data colours (copper, lichen, water, plum, steel, critical) | unchanged hues | lifted ~12% lightness for 3:1 on dark |

Every text/background pair is checked to WCAG AA (4.5:1 body, 3:1 large text and UI parts).

## 3. Build

1. `styles/tokens.css`: a `:root[data-theme="dark"]` block overriding the tokens above; `[data-theme="system"]` maps to
   it under `prefers-color-scheme: dark`. `color-scheme` set so form controls and scrollbars match.
2. Preference: `tenant_members.theme` (migration 0059, additive, default `light`); `/settings/appearance` page and a
   server action; layout writes `data-theme` on `<html>` server-side (no flash). Visitors (open access) use their
   device setting.
3. Hard-coded colours: 396 literal hex values remain in components (inline styles and 18 stylesheets, e.g. `#b0432f`
   alerts, ChatGPT's coverage and drawer colours). Replace each with its token; where no token fits, add one to
   tokens.css with both values. A lint check (scripts/check-colours.mjs, in `npm run lint`) blocks new literals outside
   tokens.css.
4. Maps and charts: mini-map tiles dimmed in dark; Atlas panels on `--atlas-*` tokens; chart palettes read tokens.

## 4. Acceptance

- Every main page (Command, each work area, a project, a deal, funding, Atlas, Settings, Start here, profile) checked in
  light and dark at desktop and phone widths: no unreadable text, no white flashes, no light-only images or borders.
- Contrast pairs above pass AA (automated check in tests).
- Typecheck, lint (including the colour check), full test suite and build pass.

Estimate: one focused session; the colour clean-up (step 3) is most of the work.
