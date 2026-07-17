import { describe, expect, it } from 'vitest';
import { normalizeJa, normalizeZh } from '../src/lib/lemmatize';

// kuromoji loads its dictionary from disk on first use (~1s).
describe('normalizeJa', { timeout: 20_000 }, () => {
  it('lemmatizes conjugated verbs to dictionary form', async () => {
    const past = await normalizeJa('食べた');
    const plain = await normalizeJa('食べる');
    expect(past?.lemma).toBe('食べる');
    expect(past?.strictKey).toBe(plain?.strictKey);
  });

  it('handles te-form progressive as one word', async () => {
    const result = await normalizeJa('食べていた');
    expect(result?.lemma).toBe('食べる');
  });

  it('gives lemma readings so kana/kanji pairs can be related', async () => {
    const kanji = await normalizeJa('分かる');
    expect(kanji?.reading).toBe('ワカル');
    const kana = await normalizeJa('わかる');
    expect(kana?.reading).toBe('ワカル');
    expect(kana?.looseKey).not.toBe(kanji?.looseKey); // merge decided at union time
  });

  it('keeps suru-compounds anchored on the noun', async () => {
    const result = await normalizeJa('勉強する');
    expect(result?.lemma).toBe('勉強');
  });

  it('rejects sentences and empty input', async () => {
    expect(await normalizeJa('私は毎日日本語を勉強します')).toBeNull();
    expect(await normalizeJa('  ')).toBeNull();
  });
});

describe('normalizeZh', () => {
  it('normalizes traditional to simplified so both count once', () => {
    expect(normalizeZh('學習')?.strictKey).toBe('学习');
    expect(normalizeZh('学习')?.strictKey).toBe('学习');
  });

  it('leaves simplified untouched and trims', () => {
    expect(normalizeZh(' 电视 ')?.lemma).toBe('电视');
  });
});
