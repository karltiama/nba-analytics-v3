# Coding standards

Only the deltas from a stock Next.js app. There is no second style guide.

- TypeScript is `strict` in the root `tsconfig.json`.
- ESLint is `eslint.config.mjs`: `eslint-config-next` core-web-vitals and TypeScript. Do not invent a parallel rule set in prose.
- Imports use `@/*` → repository root.
- Root typecheck excludes `lambda/`, `scripts/`, and `tmp/`. Code in those trees follows the package you are in.
- Tests go in `**/__tests__/**/*.test.ts`. See [testing.md](./testing.md).
- The BallDontLie env name is `BALLDONTLIE_API_KEY`. Do not add a new alias. `BALDONTLIE_API_KEY` already exists as a fallback.
- Do not add nested `AGENTS.md` files. Directory-specific procedure belongs in the doc [index.md](./index.md) already routes to.
