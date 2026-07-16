// Shared types for the schema system. Used by the seed script, the schema
// designer UI, the Zod validator builder, and the import pipeline.

export const FIELD_TYPES = [
  'TEXT',
  'LONG_TEXT',
  'NUMBER',
  'BOOLEAN',
  'ENUM',
  'LIST',
  'OBJECT',
  'AUDIO',
  'IMAGE',
  'MARKDOWN',
  'CODE',
  'LATEX',
  'JSON',
  'DATE',
  'URL',
] as const;

export type FieldTypeName = (typeof FIELD_TYPES)[number];

export interface FieldValidationRules {
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string;
  /** element type for LIST fields */
  itemType?: 'text' | 'number';
  minItems?: number;
  maxItems?: number;
}

export interface FieldDef {
  name: string;
  label: string;
  description?: string;
  fieldType: FieldTypeName;
  required?: boolean;
  validationRules?: FieldValidationRules;
  enumOptions?: string[];
  exampleValue?: unknown;
  defaultValue?: unknown;
  importInstructions?: string;
  llmInstructions?: string;
}

export interface FlashcardRule {
  name: string;
  /** template with {{fieldName}} placeholders */
  front: string;
  back: string;
  notes?: string;
}

export interface SchemaConfig {
  flashcardRules?: FlashcardRule[];
  practiceRules?: { type: string; promptField: string; answerField: string }[];
  srsRules?: { algorithm?: 'sm2'; newPerDay?: number; maxReviewsPerDay?: number };
  importInstructions?: string;
  exportInstructions?: string;
  llmPrompt?: string;
  completionCriteria?: string;
}

export interface SchemaDef {
  slug: string;
  name: string;
  itemType: string;
  category: 'LANGUAGE' | 'MATH' | 'CERTIFICATION' | 'BOOK' | 'SKILL' | 'CUSTOM';
  courseSlug?: string;
  description?: string;
  fields: FieldDef[];
  config?: SchemaConfig;
}
