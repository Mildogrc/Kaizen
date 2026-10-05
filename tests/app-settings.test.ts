import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JAPANESE_ADAPTIVE_ANKI_CONFIGURATION,
  DEFAULT_JAPANESE_GRAMMAR_CONFIGURATION,
  DEFAULT_JAPANESE_GRAMMAR_TUTOR_CONFIGURATION,
  DEFAULT_JAPANESE_KANJI_REPAIR_CONFIGURATION,
  japaneseAdaptiveAnkiConfiguration,
  japaneseGrammarConfiguration,
  japaneseGrammarTutorConfiguration,
  japaneseKanjiRepairConfiguration,
} from '../src/lib/app-settings';

describe('Japanese grammar configuration', () => {
  it('keeps the existing five-point weekly schedule by default', () => {
    expect(japaneseGrammarConfiguration(undefined)).toEqual(DEFAULT_JAPANESE_GRAMMAR_CONFIGURATION);
  });

  it('loads saved values and bounds invalid input', () => {
    expect(japaneseGrammarConfiguration({
      japaneseGrammar: { newPointsPerBatch: 12, newBatchIntervalDays: 3 },
    })).toEqual({ newPointsPerBatch: 12, newBatchIntervalDays: 3 });
    expect(japaneseGrammarConfiguration({
      japaneseGrammar: { newPointsPerBatch: 500, newBatchIntervalDays: 0 },
    })).toEqual({ newPointsPerBatch: 50, newBatchIntervalDays: 1 });
  });
});

describe('Japanese Kanji Repair configuration', () => {
  it('keeps vocabulary evidence disabled by default', () => {
    expect(japaneseKanjiRepairConfiguration(undefined)).toEqual(DEFAULT_JAPANESE_KANJI_REPAIR_CONFIGURATION);
    expect(japaneseKanjiRepairConfiguration({
      japaneseKanjiRepair: { useVocabularyPerformance: true, cooldownDays: 200 },
    })).toEqual({ useVocabularyPerformance: true, cooldownDays: 90 });
  });
});

describe('Japanese grammar tutor configuration', () => {
  it('defaults to three points without overrides', () => {
    expect(japaneseGrammarTutorConfiguration(undefined)).toEqual(DEFAULT_JAPANESE_GRAMMAR_TUTOR_CONFIGURATION);
  });

  it('loads bounded percentages and exclusions', () => {
    expect(japaneseGrammarTutorConfiguration({
      japaneseGrammarTutor: {
        planSize: 20,
        itemOverrides: {
          grammar1: { missRatePercent: 120, excluded: true },
          grammar2: { missRatePercent: -4 },
          invalid: 'remove me',
        },
      },
    })).toEqual({
      planSize: 10,
      itemOverrides: {
        grammar1: { missRatePercent: 100, excluded: true },
        grammar2: { missRatePercent: 0 },
      },
    });
  });
});

describe('Japanese adaptive Anki configuration', () => {
  it('is disabled with a conservative ten-card starting budget by default', () => {
    expect(japaneseAdaptiveAnkiConfiguration(undefined)).toEqual(DEFAULT_JAPANESE_ADAPTIVE_ANKI_CONFIGURATION);
  });

  it('bounds saved values and keeps the maximum at least the starting budget', () => {
    expect(japaneseAdaptiveAnkiConfiguration({
      japaneseAdaptiveAnki: {
        enabled: true,
        startingBudget: 30,
        maximumBudget: 20,
        coldStartProtection: false,
        targetReviewMinutes: 999,
        ankiDayStartHour: -5,
      },
    })).toEqual({
      enabled: true,
      startingBudget: 30,
      maximumBudget: 30,
      coldStartProtection: false,
      targetReviewMinutes: 240,
      ankiDayStartHour: 0,
    });
  });
});
