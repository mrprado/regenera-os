# Regenera OS design system — Systems intelligence grounded in place (2026-09-30 final lock)

Supersedes the fern/gold styling copied from regenera.bio and the interim "Territorial intelligence" palette
(2026-09-29) and the forest-black / antique-brass lock. Current direction from Prado: a blackened-eucalyptus shell,
the Regenera wordmark in mineral gold, light warm-mineral analytical surfaces, and semantic colour only where data
means it. Not generic ESG green, not another firm's palette.

Tokens live in `styles/tokens.css` (the only place colours are defined). Legacy and interim names are remapped there.

## Colour (2026-09-30 final lock: Graphite Moss + Saffron Gold + Oxidized Rust + Warm Ivory)

Supersedes the blackened-eucalyptus / mineral-gold palette of earlier the same day. Graphite Moss for the shell, Warm
Ivory for the working environment, Saffron Gold almost exclusively for the Regenera identity and key selected states,
and Oxidized Rust as the distinctive secondary accent. The logo is REGENERA in Saffron Gold #D9A61C on Graphite Moss
#252D27. No gradients, no pills in navigation, gold never a button fill.

| Role | Name | Token | Hex |
|---|---|---|---|
| Primary shell / sidebar | Graphite Moss | `--forest-carbon` (`--action`) | #252D27 |
| Deep background (Atlas, immersive) | Carbon Moss | `--atlas-base` | #1B211D |
| Shell hover / secondary dark | | `--deep-moss` / `--canopy` | #2E3830 / #3A463E |
| Main workspace | Warm Ivory | `--limestone` | #F3F0E9 |
| Cards / panels | Soft White | `--chalk` | #FBFAF7 |
| Secondary surface | | `--warm-ash` | #E8E5DE |
| Primary text | Near Black | `--text-1` | #191D1A |
| Secondary text | Mineral Grey | `--text-2` | #747A74 |
| Borders / dividers | Warm Stone | `--ash` | #D8D5CE |
| Logo / primary brand accent | Saffron Gold | `--gold`, `--brass`, `--accent` | #D9A61C |
| Saffron as text on ivory | | `--gold-ink` | #87660C |
| Secondary accent (land, development) | Oxidized Rust | `--copper` | #A45F3F |
| Dark rust | Iron Oxide | `--copper-ink` | #7D4633 |
| Secondary green (nature, inactive icons) | Muted Sage | `--lichen`, `--sage-ash` | #7B887E |
| Cool data accent (infrastructure) | Blue Grey | `--steel` | #728087 |
| Water / capital / energy / risk | semantic | `--water` / `--plum` / `--energy` / `--critical` | #4E7F7D / #67566D / #B17B2E / #AC4D43 |

Proportion: 65–75% light surfaces, 15–20% shell, 5–8% gold accents, the rest semantic.

### Sidebar treatment

- Active item: a thin gold rail (2 px, `--accent`) and a near-invisible tonal lift (`rgba(255,255,255,.025)`); white
  label, gold icon. Never a filled block.
- Hover: slight tonal lift (`rgba(255,255,255,.03)`), icon brightens from muted stone.
- Icons: muted stone (`--sage-ash`), not white.
- Wordmark: `--brass` with breathing room (letter-spacing .26em, 6 px inset).
- Section labels: 9.5 px uppercase, .2em tracking, muted stone.
- Separators: nearly invisible (`rgba(255,255,255,.025–.04)`); the menu search is an underline, not a pill.

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
