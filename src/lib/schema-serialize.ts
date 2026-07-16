// Converts DB schema rows to portable shapes: FieldDefs for validation and a
// full JSON export document for sharing / feeding to another LLM.

import type { FieldDef, FieldTypeName, SchemaConfig } from './schema-types';

// Minimal structural type matching a Prisma ContentSchemaField row.
export interface FieldRow {
  name: string;
  label: string;
  description: string | null;
  fieldType: string;
  required: boolean;
  validationRules: unknown;
  enumOptions: unknown;
  exampleValue: unknown;
  defaultValue: unknown;
  importInstructions: string | null;
  llmInstructions: string | null;
}

export function fieldRowToDef(row: FieldRow): FieldDef {
  return {
    name: row.name,
    label: row.label,
    description: row.description ?? undefined,
    fieldType: row.fieldType as FieldTypeName,
    required: row.required,
    validationRules: (row.validationRules as FieldDef['validationRules']) ?? {},
    enumOptions: (row.enumOptions as string[] | null) ?? undefined,
    exampleValue: row.exampleValue ?? undefined,
    defaultValue: row.defaultValue ?? undefined,
    importInstructions: row.importInstructions ?? undefined,
    llmInstructions: row.llmInstructions ?? undefined,
  };
}

export interface SchemaExportDoc {
  schemaName: string;
  schemaSlug: string;
  schemaVersion: number;
  itemType: string;
  category: string;
  description: string | null;
  fields: FieldDef[];
  config: SchemaConfig;
  exampleItem: Record<string, unknown>;
}

export function buildSchemaExport(input: {
  name: string;
  slug: string;
  itemType: string;
  category: string;
  description: string | null;
  version: number;
  config: unknown;
  fields: FieldRow[];
}): SchemaExportDoc {
  const fields = input.fields.map(fieldRowToDef);
  const exampleItem: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.exampleValue !== undefined) exampleItem[f.name] = f.exampleValue;
    else if (f.required) exampleItem[f.name] = f.fieldType === 'NUMBER' ? 1 : f.fieldType === 'BOOLEAN' ? true : f.fieldType === 'LIST' ? [] : '…';
  }
  return {
    schemaName: input.name,
    schemaSlug: input.slug,
    schemaVersion: input.version,
    itemType: input.itemType,
    category: input.category,
    description: input.description,
    fields,
    config: (input.config as SchemaConfig) ?? {},
    exampleItem,
  };
}
