# Testing

## Command

```bash
npm test
```

That runs `vitest run` from the repo root (`vitest.config.ts`).

## Where tests live

- Pattern: `**/__tests__/**/*.test.ts`
- Suites sit next to the code they cover (`app/`, `lib/`, `infra/`, and at least one file under `lambda/`).
- `tests/fixtures/` is fixture data. It is not the test suite.

`npm run build` does not typecheck `lambda/`, `scripts/`, or `tmp/`. A green build is not a green Lambda change. After editing a Lambda, run `npm test` and build that package the way [../infra/README.md](../infra/README.md) describes.

## What not to add

Do not add a second runner or a top-level `tests/` suite for new cases. Put the file in a colocated `__tests__` directory so the existing include pattern picks it up.
