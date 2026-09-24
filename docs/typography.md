# Court Context typography

Product UI roles for Court Context. The core product migration through Phase 6 is complete. Marketing hero display type is unchanged. Barlow Condensed is unchanged.

The classes live in `app/globals.css`. Secondary text uses `#4a6366` (`--cc-secondary`, about 6.4:1 on white).

## Roles

| Role | Class | Size / line-height | Weight | Use for |
|---|---|---|---|---|
| PAGE_TITLE | `type-page-title` | 28px / 36px | 600 | The page's primary title |
| SECTION_HEADING | `type-section-heading` | 16px / 24px | 600 | A group inside the page |
| BODY | `type-body` | 16px / 24px | 400 | Sentences and explanations. Add `font-medium` when that sentence needs weight 500 |
| CARD_PRIMARY_DATA | `type-card-data` | 16px / 24px | 600 | Player names, odds, lines, and other values the card exists to show |
| TABLE_DATA | `type-table-data` | 14px / 20px | 500 | Dense desktop research tables |
| SECONDARY | `type-secondary` | 14px / 20px | 400 | Supporting labels. Color is `#4a6366` |
| METADATA | `type-metadata` | 12px / 16px | 500 | Dates, timestamps, sources. Color is `#4a6366` |
| INTERACTIVE_LABEL | `type-interactive` | 14px / 20px | 600 | Button, input, tab, select, and chip labels |
| BADGE | `type-badge` | 12px / 16px | 600 | Status such as Good, Fair, Bad. Sentence case, not uppercase |

`type-secondary` and `type-metadata` set the text color. Other roles do not, so they can sit on white, mint, or a filled button.

`text-cc-secondary` is the same ink without a size, for a label that already has a role class.

## Rules

- 16px is the preferred size for sentence-style body copy.
- 16px / 600 is the size for important card data: player names, odds, lines, and key values.
- 14px is the floor for meaningful UI labels, controls, and dense desktop table data.
- 12px is reserved for genuinely tertiary metadata.
- 9px and 10px must not be used for meaningful words, numbers, or actions.
- Keep research surfaces dense by tightening spacing, not by shrinking type.
- Do not restyle marketing heroes, landing display type, or other display headlines with these roles.
- Chart axis labels may stay about 11–12px.
- Preview and debug badges may stay compact.
- Badge copy is sentence case (`Good`), not `GOOD VALUE`.

## Contrast

Do not use `#8aa0a3` or `#72869A` for text someone needs to read. Both fail 4.5:1 on white (about 2.75:1 and 3.76:1).

Use `#4a6366` for secondary and metadata text. It is about 6.4:1 on white.

Do not recolor decorative marks, chart strokes, or borders just because they use those grays. This does not change the rest of the palette.

## Font

Barlow Condensed stays the UI face. Geist Mono stays the mono face. Root font size is unchanged.

The next design checkpoint is a font-family reassessment. Do not change the family until that decision is made on purpose. Condensed type can still make 14–16px UI copy feel visually light. A later split could keep Barlow Condensed for display titles and use a normal-width sans for body, labels, and tables. That change is not part of this migration.

## Migration status

Foundation — COMPLETE

Phase 1 — COMPLETE. Dashboard and high-use shell.

Phase 2 — COMPLETE. Props Explorer desktop remainder.

Phase 3 — COMPLETE. Matchup, historical, and market movement.

Phase 4 — COMPLETE. Parlay workspace, X-Ray, and WOWY.

Phase 5 — COMPLETE. Player, team, and ledgers.

Phase 6 — COMPLETE. Auth, billing, landing product previews, header polish, preseason preview, and the final core sweep.

## Hierarchy

Ordinary app titles use `type-page-title`. True groups use `type-section-heading`. Sentence copy uses `type-body`. Short support uses `type-secondary`. Timestamps and compact labels use `type-metadata`. Important card values use `type-card-data`. Dense rows use `type-table-data`. Actions use `type-interactive`. Status chips use `type-badge`.

Intentionally larger titles stay outside `type-page-title`: the landing hero, auth “Welcome back” / “Create account”, the auth brand panel, “Upload your slip.”, “WOWY Impact”, player names, the team-page name, and the NBA Teams directory title.

## Approved exceptions

| Surface | Size / color | Role | Why it remains | Future review |
|---|---|---|---|---|
| Chart axis and tick labels | 11–12px, `#4a6366` where already corrected | Chart label | Approved compact chart text. Strokes stay as drawn. | Only if charts are redrawn |
| Preview mode badge | 10px white on dark teal | Debug badge | Global preview marker. It must stay small and out of the layout. | No, unless preview chrome changes |
| TeamLogo fallback, extra-small | 11px inside a 20px circle | Graphic identity | Three letters do not fit 12px in the extra-small box. Larger sizes use 12px or more. | If the extra-small box grows |
| Landing hero eyebrow and status pill | 10–13px, including `#8aa0a3` on the eyebrow | Marketing display | The hero treatment is protected and was not restyled. | Separate marketing contrast pass |
| Landing hero player card labels | 11px | Marketing display | Part of the hero composition, not a product table. | Same marketing pass |
| 404 offseason pill | 10–11px | Marketing display | Matches the hero pill. The ink is `#063f46`, which passes. | Same marketing pass |
| Inactive player dot | fill `#8aa0a3` | Decorative fill | Not text. | No |
| Away-game plane icon | `#8aa0a3` | Decorative icon | `aria` context is the date row; the icon is not the label. | No |
| X-Ray result arrow | `#8aa0a3`, `aria-hidden` | Decorative separator | Not readable text. | No |
| Admin, model lab, research SQL, content studio | 10–11px and `#8aa0a3` where present | Deferred internal UI | Not public Court Context product routes. | If those tools become public |
| `/players/[playerId]` | legacy zinc scale | Deferred route | No current product navigation link. Do not delete it. | If the route is linked again |
| Unused `PlayerCard` and `BettingInsights` | 10px / `#72869A` | Unused legacy files | Nothing imports them. | Delete only in a cleanup pass |

## What not to change globally

- Root font size
- Breakpoints
- Marketing hero classes
- Existing component classes, until that screen is migrated
