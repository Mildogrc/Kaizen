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
  wordDeckName: string;
}

export interface MeditationConfiguration {
  sessionMinutes: number;
  targetDaysPerWeek: number;
}

export const DEFAULT_MANDARIN_BLUEPRINT_CONFIGURATION: MandarinBlueprintConfiguration = {
  characterDeckName: 'Mandarin Characters',
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
