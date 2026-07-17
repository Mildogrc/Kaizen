// Generates flashcards and practice items from LearningItem data using the
// rules stored in a schema version's config (flashcardRules / practiceRules).
// Pure functions here; the DB-facing generation lives in actions.ts.

import type { FlashcardRule } from './schema-types';

/**
 * Fill a "{{field}}" template from item data. Returns null when any
 * referenced field is missing/empty — that card simply isn't generated for
 * this item (e.g. no pitch-accent card for a word without the field).
 */
export function renderTemplate(template: string, data: Record<string, unknown>): string | null {
  let missing = false;
  const out = template.replace(/\{\{(\w+)\}\}/g, (_, field: string) => {
    const value = data[field];
    if (value === undefined || value === null || value === '') {
      missing = true;
      return '';
    }
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });
  return missing ? null : out.trim();
}

export interface GeneratedCard {
  learningItemId: string;
  ruleName: string;
  front: string;
  back: string;
}

/** Apply every flashcard rule to every item; unrenderable cards are skipped. */
export function generateCards(
  items: { id: string; data: Record<string, unknown> }[],
  rules: FlashcardRule[],
): GeneratedCard[] {
  const out: GeneratedCard[] = [];
  for (const item of items) {
    for (const rule of rules) {
      const front = renderTemplate(rule.front, item.data);
      const back = renderTemplate(rule.back, item.data);
      if (front && back) {
        out.push({ learningItemId: item.id, ruleName: rule.name, front, back });
      }
    }
  }
  return out;
}

export interface PracticeRule {
  type: string;
  promptField: string;
  answerField: string;
}

export interface GeneratedPractice {
  learningItemId: string;
  type: string;
  prompt: string;
  answer: string;
}

export function generatePractice(
  items: { id: string; data: Record<string, unknown> }[],
  rules: PracticeRule[],
): GeneratedPractice[] {
  const out: GeneratedPractice[] = [];
  for (const item of items) {
    for (const rule of rules) {
      const prompt = item.data[rule.promptField];
      const answer = item.data[rule.answerField];
      if (typeof prompt === 'string' && prompt && typeof answer === 'string' && answer) {
        out.push({ learningItemId: item.id, type: rule.type, prompt, answer });
      }
    }
  }
  return out;
}
