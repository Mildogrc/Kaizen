import { describe, expect, it } from 'vitest';
import {
  beginGrammarImport,
  completeGrammarImport,
  editGrammarImport,
  EMPTY_GRAMMAR_IMPORT_FORM,
  failGrammarImport,
  GRAMMAR_IMPORT_REFRESH_PATHS,
} from '../src/lib/grammar-import';

describe('grammar lesson import feedback', () => {
  it('clears the textbox and stale errors after a successful import', () => {
    const edited = editGrammarImport(
      { ...EMPTY_GRAMMAR_IMPORT_FORM, error: 'Old error', status: 'error' },
      '{"lessonId":"lesson-1"}',
    );
    const loading = beginGrammarImport(edited);
    const completed = completeGrammarImport(loading, 'Lesson results imported.');

    expect(completed).toEqual({
      text: '',
      status: 'success',
      error: null,
      message: 'Lesson results imported.',
    });
  });

  it('preserves the pasted JSON after a failed import', () => {
    const text = '{"lessonId":"lesson-1"}';
    const loading = beginGrammarImport(editGrammarImport(EMPTY_GRAMMAR_IMPORT_FORM, text));
    const failed = failGrammarImport(loading, 'No lesson matches this lessonId.');

    expect(failed.text).toBe(text);
    expect(failed).toMatchObject({
      status: 'error',
      error: 'No lesson matches this lessonId.',
      message: null,
    });
  });

  it('refreshes every dependent view without a browser reload', () => {
    expect(GRAMMAR_IMPORT_REFRESH_PATHS).toEqual([
      '/japanese/grammar',
      '/japanese',
      '/daily',
      '/analytics',
      '/',
      '/speed-reading',
    ]);
  });
});
