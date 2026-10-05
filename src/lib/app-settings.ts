import { KANJI_REPAIR_DEFAULTS } from './kanji-repair-config';
import { ADAPTIVE_ANKI_DEFAULTS } from './adaptive-anki-config';

export type SpeedReadingMode = 'RSVP' | 'PACED' | 'CHUNKING' | 'BENCHMARK';

export interface SpeedReadingConfiguration {
  mode: SpeedReadingMode;
  wpm: number;
  chunkSize: number;
  fontSize: number;
  sessionMinutes: number;
  comprehensionThreshold: number;
  punctuationPause: boolean;
  category: string;
  difficulty: string;
}

export interface MandarinBlueprintConfiguration {
  characterDeckName: string;
  reversedCharacterDeckName: string;
  wordDeckName: string;
}

export interface MeditationConfiguration {
  sessionMinutes: number;
  targetDaysPerWeek: number;
}

export interface JapaneseGrammarConfiguration {
  newPointsPerBatch: number;
  newBatchIntervalDays: number;
}

export interface JapaneseGrammarTutorItemOverride {
  missRatePercent?: number;
  excluded?: boolean;
}

export interface JapaneseGrammarTutorConfiguration {
  planSize: number;
  itemOverrides: Record<string, JapaneseGrammarTutorItemOverride>;
}

export interface JapaneseKanjiRepairConfiguration {
  useVocabularyPerformance: boolean;
  cooldownDays: number;
}

export interface JapaneseAdaptiveAnkiConfiguration {
  enabled: boolean;
  startingBudget: number;
  maximumBudget: number;
  coldStartProtection: boolean;
  targetReviewMinutes: number;
  ankiDayStartHour: number;
}

export const DEFAULT_MANDARIN_BLUEPRINT_CONFIGURATION: MandarinBlueprintConfiguration = {
  characterDeckName: 'Mandarin Characters',
  reversedCharacterDeckName: 'Mandarin Characters Reversed',
  wordDeckName: 'Mandarin Words',
};

export const DEFAULT_SPEED_READING_CONFIGURATION: SpeedReadingConfiguration = {
  mode: 'RSVP',
  wpm: 250,
  chunkSize: 1,
  fontSize: 42,
  sessionMinutes: 5,
  comprehensionThreshold: 80,
  punctuationPause: true,
  category: 'all',
  difficulty: 'all',
};

export const DEFAULT_MEDITATION_CONFIGURATION: MeditationConfiguration = {
  sessionMinutes: 10,
  targetDaysPerWeek: 7,
};

export const DEFAULT_JAPANESE_GRAMMAR_CONFIGURATION: JapaneseGrammarConfiguration = {
  newPointsPerBatch: 5,
  newBatchIntervalDays: 7,
};

export const DEFAULT_JAPANESE_GRAMMAR_TUTOR_CONFIGURATION: JapaneseGrammarTutorConfiguration = {
  planSize: 3,
  itemOverrides: {},
};

export const DEFAULT_JAPANESE_KANJI_REPAIR_CONFIGURATION: JapaneseKanjiRepairConfiguration = {
  useVocabularyPerformance: false,
  cooldownDays: KANJI_REPAIR_DEFAULTS.cooldownDays,
};

export const DEFAULT_JAPANESE_ADAPTIVE_ANKI_CONFIGURATION: JapaneseAdaptiveAnkiConfiguration = {
  ...ADAPTIVE_ANKI_DEFAULTS,
};

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

export function speedReadingConfiguration(settings: unknown): SpeedReadingConfiguration {
  const root = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {};
  const saved = root.speedReading && typeof root.speedReading === 'object'
    ? root.speedReading as Record<string, unknown>
    : {};
  const mode = ['RSVP', 'PACED', 'CHUNKING', 'BENCHMARK'].includes(String(saved.mode))
    ? String(saved.mode) as SpeedReadingMode
    : DEFAULT_SPEED_READING_CONFIGURATION.mode;
  return {
    mode,
    wpm: boundedNumber(saved.wpm, DEFAULT_SPEED_READING_CONFIGURATION.wpm, 50, 2_000),
    chunkSize: boundedNumber(saved.chunkSize, DEFAULT_SPEED_READING_CONFIGURATION.chunkSize, mode === 'CHUNKING' ? 2 : 1, 5),
    fontSize: boundedNumber(saved.fontSize, DEFAULT_SPEED_READING_CONFIGURATION.fontSize, 16, 96),
    sessionMinutes: boundedNumber(saved.sessionMinutes, DEFAULT_SPEED_READING_CONFIGURATION.sessionMinutes, 1, 30),
    comprehensionThreshold: boundedNumber(saved.comprehensionThreshold, DEFAULT_SPEED_READING_CONFIGURATION.comprehensionThreshold, 50, 100),
    punctuationPause: typeof saved.punctuationPause === 'boolean' ? saved.punctuationPause : DEFAULT_SPEED_READING_CONFIGURATION.punctuationPause,
    category: typeof saved.category === 'string' && saved.category.trim() ? saved.category : 'all',
    difficulty: typeof saved.difficulty === 'string' && saved.difficulty.trim() ? saved.difficulty : 'all',
  };
}

export function mandarinBlueprintConfiguration(settings: unknown): MandarinBlueprintConfiguration {
  const root = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {};
  const saved = root.mandarinBlueprint && typeof root.mandarinBlueprint === 'object'
    ? root.mandarinBlueprint as Record<string, unknown>
    : {};
  const deckName = (value: unknown, fallback: string) => typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 100)
    : fallback;
  return {
    characterDeckName: deckName(saved.characterDeckName, DEFAULT_MANDARIN_BLUEPRINT_CONFIGURATION.characterDeckName),
    reversedCharacterDeckName: deckName(saved.reversedCharacterDeckName, DEFAULT_MANDARIN_BLUEPRINT_CONFIGURATION.reversedCharacterDeckName),
    wordDeckName: deckName(saved.wordDeckName, DEFAULT_MANDARIN_BLUEPRINT_CONFIGURATION.wordDeckName),
  };
}

export function meditationConfiguration(settings: unknown): MeditationConfiguration {
  const root = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {};
  const saved = root.meditation && typeof root.meditation === 'object'
    ? root.meditation as Record<string, unknown>
    : {};
  return {
    sessionMinutes: boundedNumber(saved.sessionMinutes, DEFAULT_MEDITATION_CONFIGURATION.sessionMinutes, 1, 180),
    targetDaysPerWeek: boundedNumber(saved.targetDaysPerWeek, DEFAULT_MEDITATION_CONFIGURATION.targetDaysPerWeek, 1, 7),
  };
}

export function japaneseGrammarConfiguration(settings: unknown): JapaneseGrammarConfiguration {
  const root = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {};
  const saved = root.japaneseGrammar && typeof root.japaneseGrammar === 'object'
    ? root.japaneseGrammar as Record<string, unknown>
    : {};
  return {
    newPointsPerBatch: boundedNumber(saved.newPointsPerBatch, DEFAULT_JAPANESE_GRAMMAR_CONFIGURATION.newPointsPerBatch, 1, 50),
    newBatchIntervalDays: boundedNumber(saved.newBatchIntervalDays, DEFAULT_JAPANESE_GRAMMAR_CONFIGURATION.newBatchIntervalDays, 1, 90),
  };
}

export function japaneseGrammarTutorConfiguration(settings: unknown): JapaneseGrammarTutorConfiguration {
  const root = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {};
  const saved = root.japaneseGrammarTutor && typeof root.japaneseGrammarTutor === 'object'
    ? root.japaneseGrammarTutor as Record<string, unknown>
    : {};
  const rawOverrides = saved.itemOverrides && typeof saved.itemOverrides === 'object'
    ? saved.itemOverrides as Record<string, unknown>
    : {};
  const itemOverrides = Object.fromEntries(
    Object.entries(rawOverrides).slice(0, 1_000).flatMap(([learningItemId, value]) => {
      if (!learningItemId.trim() || !value || typeof value !== 'object') return [];
      const raw = value as Record<string, unknown>;
      const override: JapaneseGrammarTutorItemOverride = {};
      const missRatePercent = Number(raw.missRatePercent);
      if (raw.missRatePercent !== '' && Number.isFinite(missRatePercent)) {
        override.missRatePercent = Math.min(100, Math.max(0, Math.round(missRatePercent)));
      }
      if (raw.excluded === true) override.excluded = true;
      return Object.keys(override).length ? [[learningItemId, override]] : [];
    }),
  );
  return {
    planSize: boundedNumber(saved.planSize, DEFAULT_JAPANESE_GRAMMAR_TUTOR_CONFIGURATION.planSize, 1, 10),
    itemOverrides,
  };
}

export function japaneseKanjiRepairConfiguration(settings: unknown): JapaneseKanjiRepairConfiguration {
  const root = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {};
  const saved = root.japaneseKanjiRepair && typeof root.japaneseKanjiRepair === 'object'
    ? root.japaneseKanjiRepair as Record<string, unknown>
    : {};
  return {
    useVocabularyPerformance: saved.useVocabularyPerformance === true,
    cooldownDays: boundedNumber(
      saved.cooldownDays,
      DEFAULT_JAPANESE_KANJI_REPAIR_CONFIGURATION.cooldownDays,
      1,
      90,
    ),
  };
}

export function japaneseAdaptiveAnkiConfiguration(settings: unknown): JapaneseAdaptiveAnkiConfiguration {
  const root = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {};
  const saved = root.japaneseAdaptiveAnki && typeof root.japaneseAdaptiveAnki === 'object'
    ? root.japaneseAdaptiveAnki as Record<string, unknown>
    : {};
  const startingBudget = boundedNumber(
    saved.startingBudget,
    DEFAULT_JAPANESE_ADAPTIVE_ANKI_CONFIGURATION.startingBudget,
    1,
    100,
  );
  return {
    enabled: saved.enabled === true,
    startingBudget,
    maximumBudget: boundedNumber(
      saved.maximumBudget,
      DEFAULT_JAPANESE_ADAPTIVE_ANKI_CONFIGURATION.maximumBudget,
      startingBudget,
      100,
    ),
    coldStartProtection: typeof saved.coldStartProtection === 'boolean'
      ? saved.coldStartProtection
      : DEFAULT_JAPANESE_ADAPTIVE_ANKI_CONFIGURATION.coldStartProtection,
    targetReviewMinutes: boundedNumber(
      saved.targetReviewMinutes,
      DEFAULT_JAPANESE_ADAPTIVE_ANKI_CONFIGURATION.targetReviewMinutes,
      10,
      240,
    ),
    ankiDayStartHour: boundedNumber(
      saved.ankiDayStartHour,
      DEFAULT_JAPANESE_ADAPTIVE_ANKI_CONFIGURATION.ankiDayStartHour,
      0,
      23,
    ),
  };
}
