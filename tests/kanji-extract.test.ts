import { describe, expect, it } from 'vitest';
import { loadKanjiExtract, parseKanjiExtract } from '../src/lib/kanji-extract';

describe('RTK kanji extract parsing', () => {
  it('loads the authoritative extract from the project root', async () => {
    const result = await loadKanjiExtract();

    expect(result.error).toBeNull();
    expect(result.sourcePath).toBe('kanji_extract.json');
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it('accepts common evolving array field names', () => {
    const result = parseKanjiExtract({
      characters: [
        { character: '議', heisigKeyword: 'deliberation', frame: 642, volume: 1, lessonNumber: 25 },
        { literal: '論', keyword: 'argument', rtkNumber: '643' },
      ],
    });
    expect(result.error).toBeNull();
    expect(result.entries).toEqual([
      expect.objectContaining({ kanji: '議', keyword: 'deliberation', rtkNumber: 642, book: 1, lesson: 25 }),
      expect.objectContaining({ kanji: '論', keyword: 'argument', rtkNumber: 643 }),
    ]);
  });

  it('accepts a kanji-keyed object and ignores duplicates', () => {
    const result = parseKanjiExtract({
      議: { keyword: 'deliberation', number: 1 },
      論: { meaning: 'argument', number: 2 },
    });
    expect(result.entries.map((entry) => entry.kanji)).toEqual(['議', '論']);
    const duplicate = parseKanjiExtract([
      { kanji: '議', keyword: 'first' },
      { kanji: '議', keyword: 'second' },
    ]);
    expect(duplicate.entries).toHaveLength(1);
    expect(duplicate.warnings.some((warning) => warning.includes('Duplicate kanji 議'))).toBe(true);
  });

  it('accepts separate arrays for both RTK books', () => {
    const result = parseKanjiExtract({
      version: 1,
      books: {
        rtk1: [{ kanji: '一', keyword: 'one', frame_number: 1, book: 'RTK 1' }],
        rtk3: [{ kanji: '亙', english: 'extend across', frameNumber: 2201, book: 'RTK 3' }],
      },
    });
    expect(result.entries).toEqual([
      expect.objectContaining({ kanji: '一', rtkNumber: 1, book: 1 }),
      expect.objectContaining({ kanji: '亙', keyword: 'extend across', rtkNumber: 2201, book: 3 }),
    ]);
  });

  it('fails gracefully when records are malformed', () => {
    expect(parseKanjiExtract({ unexpected: 'value' }).error).toContain('array');
    const result = parseKanjiExtract([{ kanji: 'not kanji' }, null, { keyword: 'missing' }]);
    expect(result.entries).toHaveLength(0);
    expect(result.error).toContain('did not contain any valid');
  });
});
