import { describe, expect, it } from 'vitest';
import { generateCards, generatePractice, renderTemplate } from '../src/lib/flashcard-gen';
import { SEED_SCHEMAS } from '../prisma/seed-data/schemas';

describe('renderTemplate', () => {
  const data = { term: '勉強', reading: 'べんきょう', meaning: 'study', tags: ['common', 'N5'], rank: 120 };

  it('substitutes fields, arrays, and numbers', () => {
    expect(renderTemplate('{{term}}（{{reading}}）', data)).toBe('勉強（べんきょう）');
    expect(renderTemplate('tags: {{tags}}', data)).toBe('tags: common, N5');
    expect(renderTemplate('#{{rank}}', data)).toBe('#120');
  });

  it('returns null when a referenced field is missing or empty', () => {
    expect(renderTemplate('{{term}} — {{pitchAccent}}', data)).toBeNull();
    expect(renderTemplate('{{term}}', { term: '' })).toBeNull();
  });
});

describe('generateCards', () => {
  const rules = [
    { name: 'recognition', front: '{{term}}', back: '{{reading}} — {{meaning}}' },
    { name: 'production', front: '{{meaning}}', back: '{{term}}（{{reading}}）' },
  ];

  it('produces one card per rule per item', () => {
    const items = [
      { id: 'a', data: { term: '猫', reading: 'ねこ', meaning: 'cat' } },
      { id: 'b', data: { term: '犬', reading: 'いぬ', meaning: 'dog' } },
    ];
    const cards = generateCards(items, rules);
    expect(cards).toHaveLength(4);
    expect(cards[0]).toEqual({ learningItemId: 'a', ruleName: 'recognition', front: '猫', back: 'ねこ — cat' });
  });

  it('skips rules whose fields an item lacks, keeps the rest', () => {
    const items = [{ id: 'a', data: { term: '猫', meaning: 'cat' } }]; // no reading
    const cards = generateCards(items, rules);
    expect(cards).toHaveLength(0); // both rules reference reading
    const partial = generateCards(items, [{ name: 'simple', front: '{{term}}', back: '{{meaning}}' }]);
    expect(partial).toHaveLength(1);
  });

  it('works against the seeded NATO schema rules', () => {
    const nato = SEED_SCHEMAS.find((s) => s.slug === 'nato-alphabet')!;
    const cards = generateCards(
      [{ id: 'x', data: { letter: 'A', word: 'Alfa', pronunciation: 'AL-fah' } }],
      nato.config!.flashcardRules!,
    );
    expect(cards.map((c) => c.front)).toEqual(['A → ?', 'Alfa → ?']);
    expect(cards.map((c) => c.back)).toEqual(['Alfa', 'A']);
  });
});

describe('generatePractice', () => {
  it('creates prompt/answer pairs and skips items missing either side', () => {
    const rules = [{ type: 'PROBLEM_SOLVING', promptField: 'problem', answerField: 'solution' }];
    const items = [
      { id: 'a', data: { problem: 'Compute 2+2', solution: '4' } },
      { id: 'b', data: { problem: 'Unsolved' } },
    ];
    const out = generatePractice(items, rules);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ learningItemId: 'a', type: 'PROBLEM_SOLVING', prompt: 'Compute 2+2', answer: '4' });
  });
});
