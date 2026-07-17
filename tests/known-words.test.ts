import { describe, expect, it } from 'vitest';
import { parseMigakuExport, unionBounds, type UnionEntry } from '../src/lib/known-words';

describe('parseMigakuExport', () => {
  it('parses JSON exports with word/reading/status and filters to Known', () => {
    const json = JSON.stringify([
      { word: '食べる', reading: 'たべる', status: 'KNOWN' },
      { word: '走る', status: 'LEARNING' },
      { word: '猫', status: 'known' },
      { word: '謎', status: 'IGNORED' },
    ]);
    const result = parseMigakuExport(json);
    expect(result.format).toBe('json');
    expect(result.words.map((w) => w.word)).toEqual(['食べる', '猫']);
    expect(result.filteredOut).toBe(2);
    expect(result.words[0].reading).toBe('たべる');
  });

  it('includes Learning when requested', () => {
    const json = JSON.stringify([{ word: '走る', status: 'Learning' }]);
    expect(parseMigakuExport(json, true).words).toHaveLength(1);
  });

  it('parses CSV with a header row, honoring quoted fields', () => {
    const csv = 'Word,Status,Reading\n食べる,Known,たべる\n"走る",Learning,はしる\n猫,Known,ねこ';
    const result = parseMigakuExport(csv);
    expect(result.format).toBe('csv');
    expect(result.words.map((w) => w.word)).toEqual(['食べる', '猫']);
  });

  it('parses plain text word-per-line (with optional status column)', () => {
    const txt = '食べる\n猫\tKNOWN\n走る\tunknown\n';
    const result = parseMigakuExport(txt);
    expect(result.format).toBe('txt');
    expect(result.words.map((w) => w.word)).toEqual(['食べる', '猫']);
  });

  it('handles empty input', () => {
    expect(parseMigakuExport('').words).toHaveLength(0);
  });
});

const entry = (partial: Partial<UnionEntry>): UnionEntry => ({
  strictKey: 'x|X',
  looseKey: 'x',
  reading: null,
  source: 'migaku',
  ...partial,
});

describe('unionBounds', () => {
  it('collapses conjugations that normalized to the same lemma', () => {
    // 食べた and 食べる both normalize to lemma 食べる — one word in both bounds.
    const entries = [
      entry({ strictKey: '食べる|タベル', looseKey: '食べる', reading: 'タベル', source: 'migaku' }),
      entry({ strictKey: '食べる|タベル', looseKey: '食べる', reading: 'タベル', source: 'anki' }),
    ];
    const b = unionBounds(entries);
    expect(b.lower).toBe(1);
    expect(b.upper).toBe(1);
    expect(b.overlap).toBe(1);
    expect(b.bySource).toEqual({ migaku: 1, anki: 1 });
  });

  it('kana-only word merging with a same-reading kanji entry tightens only the lower bound', () => {
    // Migaku knows わかる (kana); Anki has 分かる. Maybe the same word.
    const entries = [
      entry({ strictKey: 'わかる|ワカル', looseKey: 'わかる', reading: 'ワカル', source: 'migaku' }),
      entry({ strictKey: '分かる|ワカル', looseKey: '分かる', reading: 'ワカル', source: 'anki' }),
    ];
    const b = unionBounds(entries);
    expect(b.lower).toBe(1); // merged by reading
    expect(b.upper).toBe(2); // kept distinct
  });

  it('same lemma with different readings merges in lower but not upper (homographs)', () => {
    const entries = [
      entry({ strictKey: '行く|イク', looseKey: '行く', reading: 'イク' }),
      entry({ strictKey: '行く|ユク', looseKey: '行く', reading: 'ユク' }),
    ];
    const b = unionBounds(entries);
    expect(b.lower).toBe(1);
    expect(b.upper).toBe(2);
  });

  it('distinct words stay distinct in both bounds', () => {
    const entries = [
      entry({ strictKey: '猫|ネコ', looseKey: '猫', reading: 'ネコ' }),
      entry({ strictKey: '犬|イヌ', looseKey: '犬', reading: 'イヌ' }),
    ];
    const b = unionBounds(entries);
    expect(b.lower).toBe(2);
    expect(b.upper).toBe(2);
    expect(b.overlap).toBe(0);
  });

  it('chinese trad/simp normalization yields exact bounds', () => {
    // 學習 and 学习 both normalize to strict/loose key 学习 upstream.
    const entries = [
      entry({ strictKey: '学习', looseKey: '学习', source: 'migaku' }),
      entry({ strictKey: '学习', looseKey: '学习', source: 'anki' }),
      entry({ strictKey: '电视', looseKey: '电视', source: 'anki' }),
    ];
    const b = unionBounds(entries);
    expect(b.lower).toBe(2);
    expect(b.upper).toBe(2);
    expect(b.overlap).toBe(1);
  });
});
