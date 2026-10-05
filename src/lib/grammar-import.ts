export const GRAMMAR_IMPORT_REFRESH_PATHS = [
  '/japanese/grammar',
  '/japanese',
  '/daily',
  '/analytics',
  '/',
  '/speed-reading',
] as const;

export interface GrammarImportFormState {
  text: string;
  status: 'idle' | 'loading' | 'success' | 'error';
  error: string | null;
  message: string | null;
}

export const EMPTY_GRAMMAR_IMPORT_FORM: GrammarImportFormState = {
  text: '',
  status: 'idle',
  error: null,
  message: null,
};

export function editGrammarImport(
  state: GrammarImportFormState,
  text: string,
): GrammarImportFormState {
  return { ...state, text, status: 'idle', error: null, message: null };
}

export function beginGrammarImport(state: GrammarImportFormState): GrammarImportFormState {
  return { ...state, status: 'loading', error: null, message: null };
}

export function failGrammarImport(
  state: GrammarImportFormState,
  error: string,
): GrammarImportFormState {
  return { ...state, status: 'error', error, message: null };
}

export function completeGrammarImport(
  state: GrammarImportFormState,
  message: string,
): GrammarImportFormState {
  return { text: '', status: 'success', error: null, message };
}
