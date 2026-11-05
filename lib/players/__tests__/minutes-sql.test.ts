import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLOCK_MINUTES_RE, DECIMAL_MINUTES_RE, minutesDecimalSql } from '@/lib/players/minutes-sql';

describe('minutes SQL', () => {
  // These patterns are plain enough that JS RegExp and Postgres regex agree on them.
  const decimal = new RegExp(DECIMAL_MINUTES_RE);
  const clock = new RegExp(CLOCK_MINUTES_RE);

  it('only lets decimal minutes reach the numeric cast', () => {
    for (const ok of ['0', '32', '32.5']) expect(decimal.test(ok)).toBe(true);
    // "22:51" passed the old guard ('^[0-9]+.?[0-9]*$' once the template literal ate the backslash).
    for (const bad of ['22:51', '0:01', '32.', '', 'DNP']) expect(decimal.test(bad)).toBe(false);
  });

  it('recognises clock minutes', () => {
    for (const ok of ['22:51', '0:01', '12:00', '5:7']) expect(clock.test(ok)).toBe(true);
    for (const bad of ['22:75', '22', '22:51:00', '']) expect(clock.test(bad)).toBe(false);
  });

  it('reaches SQL with an escaped dot and converts seconds to a fraction', () => {
    const sql = minutesDecimalSql('l.minutes');
    expect(sql).toContain(String.raw`'^[0-9]+(\.[0-9]+)?$'`);
    expect(sql).toContain("split_part(l.minutes, ':', 2)::numeric / 60");
  });

  it('player recent form uses it instead of casting the text column', () => {
    const src = readFileSync(join(__dirname, '../analytics-queries.ts'), 'utf8');
    expect(src).toContain("${minutesDecimalSql('minutes')}");
    expect(src).not.toMatch(/minutes::numeric/);
  });
});

describe('parseMinutesText', () => {
  it('reads decimal and clock minutes like the SQL expression', async () => {
    const { parseMinutesText } = await import('@/lib/players/minutes-sql');
    expect(parseMinutesText('32')).toBe(32);
    expect(parseMinutesText(' 32.5 ')).toBe(32.5);
    expect(parseMinutesText(12)).toBe(12);
    expect(parseMinutesText('22:51')).toBeCloseTo(22.85, 10);
    expect(parseMinutesText('0:30')).toBe(0.5);
    expect(parseMinutesText('DNP-CD')).toBeNull();
    expect(parseMinutesText('22:75')).toBeNull();
    expect(parseMinutesText(null)).toBeNull();
  });
});
