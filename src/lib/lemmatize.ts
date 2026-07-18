// Server-side linguistic normalization for known-word counting.
// Japanese: kuromoji (MeCab port, IPADIC) lemmatizes conjugated forms to
// dictionary form. Chinese: OpenCC traditional→simplified; no inflection.

import kuromoji, { type IpadicFeatures, type Tokenizer } from 'kuromoji';
import * as OpenCC from 'opencc-js';
import path from 'node:path';
import { isKanaOnly, toKatakana } from './known-words';

export interface NormalizedWord {
  surface: string;
  lemma: string;
  reading: string | null; // katakana reading of the lemma (ja only)
  strictKey: string;
  looseKey: string;
}

// --------------------------------------------------------------- Japanese

type JaTokenizer = Tokenizer<IpadicFeatures>;

let tokenizerPromise: Promise<JaTokenizer> | null = null;

function getTokenizer(): Promise<JaTokenizer> {
  if (!tokenizerPromise) {
    tokenizerPromise = new Promise((resolve, reject) => {
      kuromoji
        .builder({ dicPath: path.join(process.cwd(), 'node_modules', 'kuromoji', 'dict') })
        .build((err, tokenizer) => (err ? reject(err) : resolve(tokenizer)));
    });
  }
  return tokenizerPromise;
}

// Particles, auxiliaries, and symbols never carry word identity.
const NON_CONTENT_POS = new Set(['助詞', '助動詞', '記号', 'フィラー', 'その他']);

/**
 * Normalize one Japanese word/expression to its dictionary form. Returns
 * null for entries that don't look like a single word (sentences, blanks) —
 * callers report those as "unparseable" rather than counting them.
 */
export async function normalizeJa(rawSurface: string): Promise<NormalizedWord | null> {
  const surface = rawSurface.trim();
  if (!surface) return null;
  const tokenizer = await getTokenizer();
  const tokens = tokenizer.tokenize(surface);
  const content = tokens.filter((t) => !NON_CONTENT_POS.has(t.pos));
  if (content.length === 0 || content.length > 2) return null;

  // Compound entries (e.g. する-verbs like 勉強する) keep the first content
  // token as the identity-bearing lemma.
  const head = content[0];
  const lemma = head.basic_form && head.basic_form !== '*' ? head.basic_form : head.surface_form;

  // Reading of the LEMMA (the token reading is of the conjugated surface).
  let reading: string | null = null;
  if (head.reading && head.reading !== '*' && lemma === head.surface_form) {
    reading = head.reading;
  } else {
    const lemmaTokens = tokenizer.tokenize(lemma);
    reading = lemmaTokens[0]?.reading && lemmaTokens[0].reading !== '*' ? lemmaTokens[0].reading : null;
  }
  if (!reading && isKanaOnly(lemma)) reading = toKatakana(lemma);

  return {
    surface,
    lemma,
    reading,
    strictKey: `${lemma}|${reading ?? ''}`,
    looseKey: lemma,
  };
}

// ---------------------------------------------------------------- Chinese

const t2s = OpenCC.Converter({ from: 't', to: 'cn' });

/** Chinese: canonical form = simplified string; exact keys, no bounds gap. */
export function normalizeZh(rawSurface: string): NormalizedWord | null {
  const surface = rawSurface.trim();
  if (!surface) return null;
  const simplified = t2s(surface);
  return { surface, lemma: simplified, reading: null, strictKey: simplified, looseKey: simplified };
}

export async function normalizeWord(language: 'ja' | 'zh', surface: string): Promise<NormalizedWord | null> {
  return language === 'ja' ? normalizeJa(surface) : normalizeZh(surface);
}
