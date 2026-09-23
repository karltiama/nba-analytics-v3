# Court Context typography

Product UI roles for new and migrated screens. Props Explorer mobile work should use these classes.

This is not a site-wide migration. Existing `text-xs`, `text-sm`, and `text-[10px]` classes stay until a screen is intentionally updated. Marketing display type is unchanged.

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

Barlow Condensed stays the UI face. Geist Mono stays the mono face. Do not change either in this phase.

After product screens use the scale above, decide whether condensed type still feels too small or too light at 14–16px. Until then, leave the family alone.

## What not to change globally

- Root font size
- Breakpoints
- Marketing hero classes
- Existing component classes, until that screen is migrated
