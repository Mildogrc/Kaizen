import fs from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseJlptGrammarCsv, type JlptLevel } from '../src/lib/jlpt-grammar';

const expected: Record<JlptLevel, number> = { N5: 40, N4: 50, N3: 63, N2: 63, N1: 70 };

describe('JLPT grammar CSV normalization', () => {
  for (const [level, count] of Object.entries(expected) as [JlptLevel, number][]) {
    it(`imports ${level} without spreadsheet summary rows`, async () => {
      const text = await fs.readFile(new URL(`../prisma/seed-data/jlpt-grammar/${level}.csv`, import.meta.url), 'utf8');
      const rows = parseJlptGrammarCsv(text, level);
      expect(rows).toHaveLength(count);
      expect(rows.every((row) => !/^\d+$/.test(row.pattern))).toBe(true);
    });
  }

  it('repairs the shifted N1 section', async () => {
    const text = await fs.readFile(new URL('../prisma/seed-data/jlpt-grammar/N1.csv', import.meta.url), 'utf8');
    const rows = parseJlptGrammarCsv(text, 'N1');
    expect(rows.find((row) => row.pattern === '～ものを')?.meaning).toBe('If only');
    expect(rows.find((row) => row.pattern === '～はおろか')?.meaning).toBe('Let alone');
    expect(rows.filter((row) => row.pattern === '～が早いか')).toHaveLength(1);
  });

  it('applies obvious typo corrections without trusting progress flags', async () => {
    const text = await fs.readFile(new URL('../prisma/seed-data/jlpt-grammar/N4.csv', import.meta.url), 'utf8');
    const rows = parseJlptGrammarCsv(text, 'N4');
    expect(rows.some((row) => row.pattern === '～のようにしてほしい')).toBe(true);
    expect(rows.find((row) => row.pattern === '～させられる')?.exampleJapanese).toBe('先生に読ませられた。');
  });
});
