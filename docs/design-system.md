# Regenera OS design system — Territorial intelligence (2026-09-29)

Supersedes the forest-green / gold styling copied from regenera.bio. The OS now has its own identity: intelligence
grounded in place. Land is the substrate; nature, capital and infrastructure are systems drawn on it. Brand colour is
material, not ecological; ecological colour is used only for ecological data.

Tokens live in `styles/tokens.css` (the only place colours are defined). Legacy names (`--paper`, `--fern`, `--pollen`,
`--wax` …) are remapped there, so older CSS modules follow the system automatically; new code uses the new names.

## Colour

| Role | Token | Hex | Use |
|---|---|---|---|
| Shell / immersive | `--volcanic` | #161816 | sidebar, top bar, Atlas, dark panels |
| Raised dark | `--basalt` | #20231F | active navigation, floating Atlas controls |
| Secondary dark | `--shale` | #2A2D28 | sparingly |
| Muted on dark | `--smoke` | #777C73 | borders and text on dark |
| Workspace | `--limestone` | #F2F0E9 | page background |
| Analytical sheet | `--chalk` | #FAF9F5 | tables, models, reports, forms |
| Grouping | `--sandstone` | #E7E3D8 | secondary sections |
| Hairline | `--ash` | #D4D1C8 | borders, inactive divisions |
| **Accent** | `--copper` | #B6633E | selection, active state, primary action, active map object |
| Signal | `--solar` | #E4A62A | high-priority signal, active opportunity, energy — under ~5% of any screen, never a button |
| Nature / agriculture | `--lichen` | #7C8B68 | semantic only |
| Water | `--glacial` | #5E8C91 | semantic only |
| Infrastructure | `--steel` | #727A7C | semantic only |
| Capital | `--aubergine` | #675568 | capital series, financing flows, investors |
| Critical / warning / positive | `--critical` `--warning` `--positive` | #B94B42 #C98632 #66845F | status only, always with a label or symbol |

Proportion: 60–70% neutral surface, 20–25% structural dark/light contrast, 5–10% copper, under 5% semantic.
No gradients on controls; the only gradients are inside the System Field motif (copper → solar, volcanic → basalt).

Status: typography plus a small dot — Development ● copper, Capital raise ● aubergine, Operating ● lichen, Blocked ● critical.

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

Command: limestone with chalk sheets and a dark map. Atlas: volcanic, floating basalt controls at ~94% opacity.
Project 360, Capital, Deals, Workbench, models, reports: chalk sheet on limestone. Relationship graph: volcanic.

## Components

- Buttons: `.btn` (secondary, hairline), `.btn--primary` (copper fill, chalk text), `.btn--text`, `.btn--danger`.
- Tables: 40 px rows, sticky headers, hover in limestone, selected row copper tint (`tr[aria-selected="true"]`).
- Tags: neutral outline (`ui.chip`); colour only for semantic warnings.
- Empty states: an uppercase title and one line, no illustration. Loading: quiet skeletons; Atlas keeps the map visible.

## Motif: System Field

`components/field-motif.tsx`: deterministic contour-like field lines bent by landform attractors, with a sparse network
over them and one solar node. Used only on sign-in, report covers and empty states.

## Review checklist (visual QA)

Old forest green · generic blue · oversized card · radius over 6 · content shadow · rainbow palette · weak hierarchy ·
inconsistent surface or type · colour without meaning. Fix on sight.
