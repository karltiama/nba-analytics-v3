/**
 * Stub for all-team generation. Intentionally refuses to run in V1.
 *
 * Usage (blocked):
 *   npm run preseason:generate:all -- --season=2026
 */

function main() {
  console.error(
    [
      'preseason:generate:all is intentionally disabled for V1.',
      'Complete the Detroit reference review before generating other teams.',
      'Use: npm run preseason:generate -- --team=DET --season=2026',
    ].join('\n')
  );
  process.exit(1);
}

main();
