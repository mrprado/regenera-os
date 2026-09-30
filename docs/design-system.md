# Regenera OS design system — Systems intelligence grounded in place (2026-09-30)

Supersedes the fern/gold styling copied from regenera.bio and the interim "Territorial intelligence" palette
(2026-09-29). Final direction from Prado: a deep forest-carbon shell, the Regenera wordmark in gold, light mineral
analytical surfaces, and semantic colour only where data means it. Not generic ESG green, not another firm's palette.

Tokens live in `styles/tokens.css` (the only place colours are defined). Legacy and interim names are remapped there.

## Colour (LOCKED 2026-09-30)

Dark forest + aged brass + limestone + iron + earth. Green and brass establish the identity; the working environment
stays limestone, charcoal and semantic data colour. Sophistication comes from typography, spacing, data visualization,
motion and layout — not further colour changes. No blue, purple, orange or pure black as the primary architecture.

| Role | Token | Hex | Use |
|---|---|---|---|
| Forest black | `--forest-carbon` | #0D1511 | sidebar, header, primary buttons |
| Pine carbon | `--deep-moss` | #16201A | hover, active navigation, elevated dark surface |
| Moss graphite | `--canopy` | #263028 | secondary dark panel, button hover |
| Shell metadata | `--sage-ash` | #7C877E | inactive labels on dark |
| Atlas base | `--atlas-base` | #0A110D | immersive spatial workspace |
| Antique brass | `--brass` | #8F6B24 | the Regenera wordmark |
| Old gold | `--gold` / `--accent` | #A37C2D | nav and tab markers, selected high-level object, opportunity, important signal — never a button fill |
| Limestone | `--limestone` | #F1EEE6 | main workspace |
| Bone | `--chalk` | #FAF8F2 | analysis, tables, reports |
| Parchment | `--warm-ash` | #E4DED1 | secondary surface |
| Ink / Stone | `--text-1` / `--text-2` | #191C19 / #6B6D67 | primary / secondary text |
| Land / development | `--copper` | #9B6248 | semantic |
| Nature / agriculture | `--lichen` | #6F8062 | semantic |
| Water | `--water` | #557F7C | semantic |
| Capital | `--plum` | #655468 | semantic |
| Infrastructure | `--steel` | #6D7573 | semantic |
| Energy | `--energy` | #B17B2E | semantic |
| Risk | `--critical` | #A84B40 | status, always with a label or symbol |

Proportion: 65–75% light surfaces, 15–20% forest shell, 5–8% brass/gold accents, the rest semantic.

## Type

Geist (UI) and Geist Mono (coordinates, identifiers, model values), loaded from Google Fonts. Weights 400/500/600 —
no 700/800 as a default. Scale: display 28–38, page title 25, section 19, subsection 15, body 13.5, metadata 11.5.
Numbers use tabular figures everywhere (`td`, `.num`).

## Shape, space, motion

- Radius: panels 0–3, controls 4, dialogs 6; pills only for filter chips.
- Shadow: none on content; `--shadow-overlay` only for menus, dialogs, overlays.
- Borders: hairline separators between sections instead of boxed cards (`record.module.css .panel` is a ruled
  section, not a card). Metric strips are typographic (`ui.module.css .stats`), not tiles.
- Spacing: 8 px grid (`--s1`…`--s8`).
- Motion: 120 / 180 / 220 / 280 ms with `--ease`; fade, slide, reveal, focus. No bounce. Reduced motion zeroes it.

## Surfaces by environment

Command: limestone with chalk sheets and a green-charcoal map. Atlas: `--atlas-base`, floating deep-moss controls at ~94% opacity; selection gold, development copper.
Project 360, Capital, Deals, Workbench, models, reports: chalk sheet on limestone. Relationship graph: volcanic.

## Components

- Buttons: `.btn` (secondary, hairline), `.btn--primary` (forest-carbon fill, chalk text), `.btn--text`, `.btn--danger`.
- Tables: 40 px rows, sticky headers, hover in limestone, selected row gold tint (`tr[aria-selected="true"]`).
- Tags: neutral outline (`ui.chip`); colour only for semantic warnings.
- Empty states: an uppercase title and one line, no illustration. Loading: quiet skeletons; Atlas keeps the map visible.

## Motif: System Field

`components/field-motif.tsx`: deterministic contour-like field lines bent by landform attractors, with a sparse network
over them; green, gold and copper used sparingly. Used only on sign-in, report covers and empty states.

## Review checklist (visual QA)

Old forest green · generic blue · oversized card · radius over 6 · content shadow · rainbow palette · weak hierarchy ·
inconsistent surface or type · colour without meaning. Fix on sight.
