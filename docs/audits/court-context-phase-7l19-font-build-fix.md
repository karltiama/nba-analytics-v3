# Court Context — Phase 7L.19: Self-Hosted Font Build Fix

Date: 2026-11-16

Worktree: `C:\Users\tiama\Desktop\Coding\nba-analytics-v3-7l18`
Branch: `fix/self-hosted-fonts-7l19`
Base: `a2e26dd0d6e9fd8145a708ecaad42329f6648f23`
Font commit: `5eaf3f0138681c9f714d357a12aeae6558d5ede0`

No push, pull request, merge, or deployment was made.

## A. Root-cause confirmation

Production deployment `dpl_CoZobJhiaL3a7b3y8APQAYzzAbB2` failed while compiling `components/content/context-check/instagram-fonts.ts`. Google Fonts returned an extensionless `fonts.gstatic.com/l/font?kit=...&skey=...&v=...` URL. The body was a valid WOFF2 file. Next.js 16.0.10's font loader cannot parse that URL.

Turbopack reports `Can't resolve '@vercel/turbopack-next/internal/font/google/font'` because the query string is split on `&` and then rejected as more than one entry. Webpack fails later in `next/dist/compiled/@next/font/dist/google/loader.js` because the URL has no `.woff2` suffix. A 200 response is not retried.

The same master commit can compile when Google returns ordinary `.woff2` URLs. That is why a rebuild of `a2e26dd` is not a fix. League Spartan was already local for this reason. The remaining `next/font/google` calls were Inter, Manrope, Archivo Black, Barlow Condensed, and Geist Mono.

## B. Fonts and assets changed

`next/font/google` is no longer imported. Each family is `next/font/local`, `display: 'swap'`, latin only, with the same CSS variable names.

| Family | Weights | File | Bytes |
|---|---|---|---:|
| Inter | 500, 600, 700 static | `components/content/context-check/fonts/inter-latin-{500,600,700}.woff2` | 24,272 / 24,452 / 24,356 |
| Manrope | 500, 600, 700 static | `components/content/context-check/fonts/manrope-latin-{500,600,700}.woff2` | 14,044 / 14,172 / 14,212 |
| Archivo Black | 400 static | `components/content/context-check/fonts/archivo-black-latin-400.woff2` | 18,604 |
| Barlow Condensed | 400, 500, 600, 700, 800 static | `app/fonts/barlow-condensed-latin-{400,500,600,700,800}.woff2` | 21,164 / 21,424 / 22,308 / 22,444 / 22,464 |
| Geist Mono | variable 100–900 | `app/fonts/geist-mono-latin-wght.woff2` | 31,368 |
| League Spartan | variable 600–700 | `components/content/context-check/fonts/LeagueSpartan-latin-variable.woff2` | 24,020, unchanged |

Instagram Barlow uses the shared 600 and 700 files. One copy is emitted. Every new file starts with WOFF2 magic `774f4632`.

Static latin files came from Fontsource 5.2.8 (`cdn.jsdelivr.net/fontsource/fonts/<family>@5.2.8/latin-<weight>-normal.woff2`). Geist Mono came from `@fontsource-variable/geist-mono@5.2.6` file `geist-mono-latin-wght-normal.woff2`. No font package was added to `package.json`.

## C. Licensing verification

All five added families are SIL Open Font License 1.1. The license text is stored next to the files.

| Family | Copyright line | License source |
|---|---|---|
| Inter | Copyright (c) 2016 The Inter Project Authors | `rsms/inter` `LICENSE.txt` |
| Manrope | Copyright 2018 The Manrope Project Authors | `google/fonts` `ofl/manrope/OFL.txt` |
| Archivo Black | Copyright 2017 The Archivo Black Project Authors | `google/fonts` `ofl/archivoblack/OFL.txt` |
| Barlow Condensed | Copyright 2017 The Barlow Project Authors | `google/fonts` `ofl/barlowcondensed/OFL.txt` |
| Geist Mono | Copyright (c) 2023 Vercel, in collaboration with basement.studio | `vercel/geist-font` `LICENSE.txt` |

## D. Original versus updated configuration

CSS variables are unchanged.

| Use | Variable | Before | After |
|---|---|---|---|
| Root mono | `--font-geist-mono` | `Geist_Mono`, latin, variable 100–900 | local variable file, weight `100 900`, style normal |
| Root sans and display | `--font-barlow-condensed` | `Barlow_Condensed` 400–800, latin | the same five static weights |
| Instagram display, default | `--font-cc-archivo-black` | Archivo Black 400 | local 400 |
| Instagram body | `--font-cc-manrope` | Manrope 500, 600, 700 | the same three weights |
| Instagram display, league card | `--font-cc-league-spartan` | existing local file | unchanged |
| Instagram body, league card | `--font-cc-inter` | Inter 500, 600, 700 | the same three weights |
| Instagram display, Barlow card | `--font-cc-barlow-condensed` | Barlow Condensed 600, 700 | the shared layout files |

`app/globals.css` and `instagram-type.css` were not edited. `--font-sans` and `--font-display` still read `var(--font-barlow-condensed)`. The three Instagram cards still map display and body onto the same `--font-cc-*` variables, with the same weights: Archivo display 400, League and Barlow display 700, Manrope and Inter body 500, 600, and 700.

`adjustFontFallback: 'Arial'` matches the size-adjust fallback the Google loader already emitted. `display: 'swap'` matches the previous calls. Geist Mono's local fallback is Arial metrics because `next/font/local` does not have a separate monospace fallback.

The production CSS from the Turbopack build contains `@font-face` rules for those exact families, weights, and `font-display: swap`, with `url(../media/*.woff2)`. The variable classes are `--font-geist-mono`, `--font-barlow-condensed`, and the five `--font-cc-*` names.

## E. Build and test results

Local Node is v22.17.1. `package.json` pins Node 24.x, so `npm ci` warned `EBADENGINE`. The font failure is in the Next font loader, and this Node 22 toolchain reproduced it in Phase 7L.18. No dependency was upgraded.

| Check | Result |
|---|---|
| `npm ci` | Exit 0. 750 packages. |
| `tsc -p tsconfig.build.json --noEmit` | Exit 0 after removing a stale `.next`. The first run failed on an old generated route type, not on these files. |
| `vitest run app/__tests__/typography-foundation.test.ts` | 2 tests passed. The test now requires the local Barlow file and rejects a `next/font/google` import. |
| `eslint` on the three source files | Exit 0. |
| `next build` (Turbopack 16.0.10) | Exit 0. Compiled in 7.9s. `/admin/content/context-check` is in the route table. |
| `next build --webpack` | Font compilation succeeded in 32.4s. The build then exited 1 on the existing `QUICK_BUILD_FIVE_LEG_AVAILABLE` export in `app/api/parlay-workspace/quick-builds/route.ts`. That file was not changed. |

Both builds set `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` to a module whose export is `{}`. Next throws `Missing mocked response for URL` when a `next/font/google` call asks for CSS. Neither compiler raised that error. The built `.next` output contains no `fonts.googleapis.com` or `fonts.gstatic.com` string.

The first Turbopack run, with the mock and no database URL, compiled and typechecked, then stopped at `Missing SUPABASE_DB_URL` while collecting page data. That is the same local environment gap as unmodified `a2e26dd`. The completed build used a placeholder URL on `127.0.0.1:9` and a non-resolving public Supabase host. No production database was contacted.

A local `next start` was not started. Port 3000 had no listener. The Instagram card contract was checked from the compiled CSS: the three type variants, their weights, and their CSS variables match the source that was already in production.

## F. Asset-size impact

New WOFF2 bytes, excluding the unchanged League Spartan file: **275,284**.

The Turbopack build copies those files byte for byte. With League Spartan, the emitted media total is 299,304 bytes across 14 files. Barlow 600 and 700 are not duplicated.

The current Ready site, `dpl_8i7HGJngFPawDzF2P4D8asTozADt`, preloads six unlabeled `/_next/static/media/*.woff2` files on the homepage, totaling 96,956 bytes. Those hashes do not name a family, and the homepage does not load the Instagram card fonts, so that total is not a per-family baseline. The new site-wide set, five Barlow weights plus Geist Mono, is 141,172 bytes.

## G. Source commit and changed files

Commit `5eaf3f0138681c9f714d357a12aeae6558d5ede0` on `fix/self-hosted-fonts-7l19`.

21 files, 511 insertions, 19 deletions:

- `app/layout.tsx`
- `app/__tests__/typography-foundation.test.ts`
- `app/fonts/barlow-condensed-latin-400.woff2`
- `app/fonts/barlow-condensed-latin-500.woff2`
- `app/fonts/barlow-condensed-latin-600.woff2`
- `app/fonts/barlow-condensed-latin-700.woff2`
- `app/fonts/barlow-condensed-latin-800.woff2`
- `app/fonts/barlow-condensed-OFL.txt`
- `app/fonts/geist-mono-latin-wght.woff2`
- `app/fonts/geist-mono-OFL.txt`
- `components/content/context-check/instagram-fonts.ts`
- `components/content/context-check/fonts/inter-latin-500.woff2`
- `components/content/context-check/fonts/inter-latin-600.woff2`
- `components/content/context-check/fonts/inter-latin-700.woff2`
- `components/content/context-check/fonts/inter-OFL.txt`
- `components/content/context-check/fonts/manrope-latin-500.woff2`
- `components/content/context-check/fonts/manrope-latin-600.woff2`
- `components/content/context-check/fonts/manrope-latin-700.woff2`
- `components/content/context-check/fonts/manrope-OFL.txt`
- `components/content/context-check/fonts/archivo-black-latin-400.woff2`
- `components/content/context-check/fonts/archivo-black-OFL.txt`

League Spartan was not in the commit. The main checkout remains `fix/ops-collector-health` at `067540bcadbbb4ed899bfbe387bc2f5bec1a98f8`. Its uncommitted files were not staged.

## H. Confirmation of no production changes

- No Vercel deployment.
- No Git push, pull request, or merge.
- No database write.
- No Lambda, schedule, Terraform, S3, or Supabase change.
- No ingestion canary.
- `package.json` and `package-lock.json` were not changed.
- `courtcontext.com` remains on Ready deployment `dpl_8i7HGJngFPawDzF2P4D8asTozADt`.

## I. GO / NO-GO

**GO** to request a separate pull request from `fix/self-hosted-fonts-7l19`.

The pull request should contain the font commit and this audit. Opening it will create a Vercel preview. Merging it will publish a production deployment. Neither of those is authorized by this phase.

**NO-GO** to push, open the pull request, merge, or deploy from this phase.

Webpack `next build --webpack` still exits 1 on this branch because of the pre-existing Quick Builds route export. The production builder is Turbopack, and that build exits 0 with the Google font fetch disabled. The webpack type error should be named in the pull request so it is not mistaken for a font regression.
