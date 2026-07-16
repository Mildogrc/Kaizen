import { describe, expect, it } from 'vitest';
import { buildZodSchema, validateItems } from '../src/lib/schema-zod';
import type { FieldDef } from '../src/lib/schema-types';

const fields: FieldDef[] = [
  { name: 'term', label: 'Term', fieldType: 'TEXT', required: true, validationRules: { minLength: 1 } },
  { name: 'meaning', label: 'Meaning', fieldType: 'TEXT', required: true },
  { name: 'level', label: 'Level', fieldType: 'ENUM', enumOptions: ['N5', 'N4', 'N3'] },
  { name: 'rank', label: 'Rank', fieldType: 'NUMBER', validationRules: { min: 1, max: 100 } },
  { name: 'tags', label: 'Tags', fieldType: 'LIST', validationRules: { itemType: 'text', maxItems: 3 } },
  { name: 'known', label: 'Known', fieldType: 'BOOLEAN' },
  { name: 'source', label: 'Source', fieldType: 'URL' },
];

describe('buildZodSchema', () => {
  const schema = buildZodSchema(fields);

  it('accepts a fully valid item', () => {
    const result = schema.safeParse({
      term: '勉強', meaning: 'study', level: 'N5', rank: 10, tags: ['common'], known: true,
      source: 'https://example.com',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an item with only required fields', () => {
    expect(schema.safeParse({ term: '猫', meaning: 'cat' }).success).toBe(true);
  });

  it('rejects a missing required field', () => {
    expect(schema.safeParse({ term: '猫' }).success).toBe(false);
  });

  it('rejects an invalid enum value', () => {
    expect(schema.safeParse({ term: '猫', meaning: 'cat', level: 'N9' }).success).toBe(false);
  });

  it('rejects out-of-range numbers', () => {
    expect(schema.safeParse({ term: '猫', meaning: 'cat', rank: 0 }).success).toBe(false);
    expect(schema.safeParse({ term: '猫', meaning: 'cat', rank: 101 }).success).toBe(false);
  });

  it('rejects list rule violations', () => {
    expect(schema.safeParse({ term: '猫', meaning: 'cat', tags: ['a', 'b', 'c', 'd'] }).success).toBe(false);
    expect(schema.safeParse({ term: '猫', meaning: 'cat', tags: [1] }).success).toBe(false);
  });

  it('rejects unknown keys (strict contract for LLM output)', () => {
    expect(schema.safeParse({ term: '猫', meaning: 'cat', bogus: 'x' }).success).toBe(false);
  });

  it('rejects invalid URLs and wrong primitive types', () => {
    expect(schema.safeParse({ term: '猫', meaning: 'cat', source: 'not a url' }).success).toBe(false);
    expect(schema.safeParse({ term: '猫', meaning: 'cat', known: 'yes' }).success).toBe(false);
  });
});

describe('validateItems', () => {
  it('partitions a mixed batch into valid and invalid with error details', () => {
    const result = validateItems(fields, [
      { term: '水', meaning: 'water' },
      { term: '', meaning: 'empty term violates minLength' },
      { meaning: 'missing term' },
      { term: '火', meaning: 'fire', level: 'N4' },
    ]);
    expect(result.valid.map((v) => v.index)).toEqual([0, 3]);
    expect(result.invalid.map((v) => v.index)).toEqual([1, 2]);
    expect(result.invalid[1].errors.join(' ')).toContain('term');
  });
});
