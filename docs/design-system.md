# Regenera OS design system — Systems intelligence grounded in place (2026-09-30)

Supersedes the fern/gold styling copied from regenera.bio and the interim "Territorial intelligence" palette
(2026-09-29). Final direction from Prado: a deep forest-carbon shell, the Regenera wordmark in gold, light mineral
analytical surfaces, and semantic colour only where data means it. Not generic ESG green, not another firm's palette.

Tokens live in `styles/tokens.css` (the only place colours are defined). Legacy and interim names are remapped there.

## Colour

| Role | Token | Hex | Use |
|---|---|---|---|
| Shell | `--forest-carbon` | #15251F | sidebar, header, primary buttons |
| Elevated shell | `--deep-moss` | #1D332A | hover, active navigation, secondary shell panels |
| Secondary green | `--canopy` | #29483A | sparingly (button hover) |
| Muted shell text | `--sage-ash` | #718176 | inactive labels, metadata on dark |
| Atlas base | `--atlas-base` | #101813 | immersive spatial workspace |
| Workspace | `--limestone` | #F3F1EA | page background |
| Analytical sheet | `--chalk` | #FCFBF7 | tables, models, reports, forms |
| Secondary surface | `--warm-ash` | #E6E3DA | grouping |
| Text | `--text-1` / `--text-2` | #1A1C1A / #686C68 | graphite / muted graphite |
| **Signature** | `--gold` | #D9A52E | Regenera wordmark, nav and tab markers, selected high-level object, opportunity, important signal — never a button fill |
| Land / development | `--copper` | #B66A47 | land, physical assets, selected geometry |
| Nature | `--lichen` | #76896A | nature, agriculture, ecology, restoration |
| Water | `--water` | #598A8C | hydrology |
| Capital | `--plum` | #6A566B | capital, funds, investors |
| Infrastructure | `--steel` | #727C7C | infrastructure |
| Status | `--critical` `--warning` `--positive` | #B84C43 #C78332 #5F7F58 | always with a label or symbol |

Proportion: 65–75% light surfaces, 15–20% green shell, 5–8% gold/active accents, the rest semantic.

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
