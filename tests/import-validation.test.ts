import { describe, expect, it } from 'vitest';
import { validateItems } from '../src/lib/schema-zod';
import { SEED_SCHEMAS } from '../prisma/seed-data/schemas';

describe('seed schema import validation', () => {
  it('every seed schema example values form a valid item skeleton', () => {
    for (const schema of SEED_SCHEMAS) {
      // Build an item from required fields' example values (fall back per type).
      const item: Record<string, unknown> = {};
      for (const f of schema.fields) {
        if (!f.required) continue;
        item[f.name] =
          f.exampleValue ??
          (f.fieldType === 'NUMBER' ? 1
            : f.fieldType === 'BOOLEAN' ? true
            : f.fieldType === 'LIST' ? ['x']
            : f.fieldType === 'ENUM' ? f.enumOptions?.[0]
            : 'placeholder');
      }
      const result = validateItems(schema.fields, [item]);
      expect(result.invalid, `schema ${schema.slug} rejected its own example: ${JSON.stringify(result.invalid)}`).toHaveLength(0);
    }
  });

  it('japanese vocabulary schema rejects malformed LLM output', () => {
    const vocab = SEED_SCHEMAS.find((s) => s.slug === 'japanese-vocabulary')!;
    const result = validateItems(vocab.fields, [
      { term: '勉強', reading: 'べんきょう', meaning: 'study', jlptLevel: 'N5' }, // valid
      { term: '勉強', reading: 'べんきょう' }, // missing meaning
      { term: '勉強', reading: 'べんきょう', meaning: 'study', jlptLevel: 'N6' }, // bad enum
      { term: '勉強', reading: 'べんきょう', meaning: 'study', extraField: 'nope' }, // unknown key
      { term: '勉強', reading: 'べんきょう', meaning: 'study', frequencyRank: -5 }, // rule violation
    ]);
    expect(result.valid.map((v) => v.index)).toEqual([0]);
    expect(result.invalid).toHaveLength(4);
  });

});
