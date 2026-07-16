// Builds a self-contained markdown prompt from a schema export. The user
// downloads this .md, sends it to any LLM together with source material, and
// gets back a JSON array that the import page validates against the same
// schema.

import type { SchemaExportDoc } from './schema-serialize';
import type { FieldDef } from './schema-types';

function fieldRules(f: FieldDef): string {
  const rules: string[] = [];
  const v = f.validationRules ?? {};
  if (f.fieldType === 'ENUM' && f.enumOptions?.length) rules.push(`one of: ${f.enumOptions.map((o) => `"${o}"`).join(', ')}`);
  if (f.fieldType === 'LIST') rules.push(`array of ${v.itemType === 'number' ? 'numbers' : 'strings'}`);
  if (v.minLength !== undefined) rules.push(`min length ${v.minLength}`);
  if (v.maxLength !== undefined) rules.push(`max length ${v.maxLength}`);
  if (v.min !== undefined) rules.push(`min ${v.min}`);
  if (v.max !== undefined) rules.push(`max ${v.max}`);
  if (v.pattern) rules.push(`must match /${v.pattern}/`);
  if (v.minItems !== undefined) rules.push(`min ${v.minItems} items`);
  if (v.maxItems !== undefined) rules.push(`max ${v.maxItems} items`);
  return rules.join('; ');
}

function jsonType(f: FieldDef): string {
  switch (f.fieldType) {
    case 'NUMBER': return 'number';
    case 'BOOLEAN': return 'boolean';
    case 'LIST': return 'array';
    case 'OBJECT': case 'JSON': return 'object';
    default: return 'string';
  }
}

export function buildLlmPromptMd(doc: SchemaExportDoc): string {
  const required = doc.fields.filter((f) => f.required);
  const optional = doc.fields.filter((f) => !f.required);

  const fieldRow = (f: FieldDef) =>
    `| \`${f.name}\` | ${jsonType(f)} (${f.fieldType.toLowerCase().replace('_', ' ')}) | ${f.required ? '**yes**' : 'no'} | ${fieldRules(f) || '—'} | ${[f.description, f.llmInstructions].filter(Boolean).join(' ')} |`;

  const badItem: Record<string, unknown> = { ...doc.exampleItem, madeUpField: 'not allowed' };
  const firstEnum = doc.fields.find((f) => f.fieldType === 'ENUM' && f.enumOptions?.length);
  if (firstEnum) badItem[firstEnum.name] = 'INVALID_OPTION';

  return `# Content generation task: ${doc.schemaName}

You are generating study content for a personal learning app. Convert the
source material provided together with this prompt into a **JSON array of
\`${doc.itemType}\` items** that conforms exactly to the schema below
(schema \`${doc.schemaSlug}\`, version ${doc.schemaVersion}).

${doc.description ? `> ${doc.description}\n` : ''}${doc.config.llmPrompt ? `\nDomain guidance: ${doc.config.llmPrompt}\n` : ''}
## Output rules

1. Return **only** a JSON array. No markdown fences, no commentary, no explanations.
2. Every item must conform exactly to the field specification. Unknown or extra keys cause the item to be **rejected**.
3. Include every required field in every item.
4. Omit optional fields you cannot fill accurately — never invent data.
5. Convert **all** of the provided source material unless instructed otherwise.
6. Strings must use the exact enum spellings where an enum is specified.

## Field specification

| field | JSON type | required | rules | notes |
|---|---|---|---|---|
${required.map(fieldRow).join('\n')}
${optional.map(fieldRow).join('\n')}

## Valid output example

${'```'}json
${JSON.stringify([doc.exampleItem], null, 2)}
${'```'}

## Invalid example — do NOT do this

${'```'}json
${JSON.stringify([badItem], null, 2)}
${'```'}

Why it fails: \`madeUpField\` is not in the schema (unknown keys are rejected)${firstEnum ? `, and \`${firstEnum.name}\` is not one of the allowed enum values` : ''}.

## Source material

The source material follows this prompt. Convert it now, returning only the JSON array.
`;
}
