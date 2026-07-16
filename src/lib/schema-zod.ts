// Builds a Zod validator from ContentSchemaField definitions. Used by the
// import pipeline and by tests. Works on plain FieldDef objects so it can run
// against DB rows (mapped) or seed definitions directly.

import { z } from 'zod';
import type { FieldDef, FieldValidationRules } from './schema-types';

function applyStringRules(schema: z.ZodString, rules: FieldValidationRules): z.ZodString {
  let s = schema;
  if (rules.minLength !== undefined) s = s.min(rules.minLength);
  if (rules.maxLength !== undefined) s = s.max(rules.maxLength);
  if (rules.pattern) s = s.regex(new RegExp(rules.pattern));
  return s;
}

export function zodForField(field: FieldDef): z.ZodType {
  const rules = field.validationRules ?? {};
  let schema: z.ZodType;

  switch (field.fieldType) {
    case 'NUMBER': {
      let n = z.number();
      if (rules.min !== undefined) n = n.min(rules.min);
      if (rules.max !== undefined) n = n.max(rules.max);
      schema = n;
      break;
    }
    case 'BOOLEAN':
      schema = z.boolean();
      break;
    case 'ENUM': {
      const options = field.enumOptions ?? [];
      schema = options.length > 0 ? z.enum(options as [string, ...string[]]) : z.string();
      break;
    }
    case 'LIST': {
      const item = rules.itemType === 'number' ? z.number() : z.string();
      let arr = z.array(item);
      if (rules.minItems !== undefined) arr = arr.min(rules.minItems);
      if (rules.maxItems !== undefined) arr = arr.max(rules.maxItems);
      schema = arr;
      break;
    }
    case 'OBJECT':
      schema = z.record(z.string(), z.unknown());
      break;
    case 'JSON':
      schema = z.union([z.record(z.string(), z.unknown()), z.array(z.unknown()), z.string(), z.number(), z.boolean()]);
      break;
    case 'URL':
      schema = z.string().url();
      break;
    case 'DATE':
      schema = z.string().refine((v) => !Number.isNaN(Date.parse(v)), { message: 'Invalid date string' });
      break;
    // All remaining types are stored as strings.
    case 'TEXT':
    case 'LONG_TEXT':
    case 'MARKDOWN':
    case 'CODE':
    case 'LATEX':
    case 'AUDIO':
    case 'IMAGE':
    default:
      schema = applyStringRules(z.string(), rules);
      break;
  }

  return field.required ? schema : schema.optional();
}

export function buildZodSchema(fields: FieldDef[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const f of fields) shape[f.name] = zodForField(f);
  // strict: unknown keys are errors, so LLM/import output must conform exactly.
  return z.strictObject(shape);
}

export interface ItemValidationError {
  index: number;
  errors: string[];
}

export interface ValidationResult {
  valid: { index: number; data: Record<string, unknown> }[];
  invalid: ItemValidationError[];
}

/** Validate an array of candidate items against schema fields. */
export function validateItems(fields: FieldDef[], items: unknown[]): ValidationResult {
  const schema = buildZodSchema(fields);
  const result: ValidationResult = { valid: [], invalid: [] };
  items.forEach((item, index) => {
    const parsed = schema.safeParse(item);
    if (parsed.success) {
      result.valid.push({ index, data: parsed.data as Record<string, unknown> });
    } else {
      result.invalid.push({
        index,
        errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
      });
    }
  });
  return result;
}
