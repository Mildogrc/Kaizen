import {
  cloneDeckConfigId,
  deckNames,
  getDeckConfig,
  newCardCount,
  saveDeckConfig,
  setDeckConfigId,
  type AnkiDeckConfig,
} from './anki-connect';
import { allocateAdaptiveBudget } from './adaptive-anki-budget';
import { nestedDeckFallback } from './anki-deck';

export interface AdaptiveDeckState {
  originalConfigId: string;
  managedConfigId: string;
  managedConfigName: string;
}

export interface AdaptiveDeckInput {
  mappingId: string;
  deckName: string;
  state: AdaptiveDeckState | null;
}

export interface AdaptiveAnkiClient {
  deckNames(): Promise<string[]>;
  getDeckConfig(deck: string): Promise<AnkiDeckConfig | false>;
  saveDeckConfig(config: AnkiDeckConfig): Promise<boolean>;
  cloneDeckConfigId(name: string, cloneFrom: number): Promise<number | false>;
  setDeckConfigId(decks: string[], configId: number): Promise<boolean>;
  newCardCount(deckName: string): Promise<number>;
}

export const adaptiveAnkiClient: AdaptiveAnkiClient = {
  deckNames,
  getDeckConfig,
  saveDeckConfig,
  cloneDeckConfigId,
  setDeckConfigId,
  newCardCount,
};

export interface AdaptiveDeckApplicationResult {
  mappingId: string;
  deckName: string;
  availableNew: number;
  budget: number;
  ok: boolean;
  error?: string;
  state?: AdaptiveDeckState;
}

function configId(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function managedConfigName(deckName: string): string {
  return `Hyperlearning Adaptive · ${deckName}`.slice(0, 100);
}

async function applyDeck(
  deck: AdaptiveDeckInput & { ankiDeckName: string; availableNew: number; budget: number },
  client: AdaptiveAnkiClient,
): Promise<AdaptiveDeckApplicationResult> {
  const base = { mappingId: deck.mappingId, deckName: deck.deckName, availableNew: deck.availableNew, budget: deck.budget };
  try {
    let config = await client.getDeckConfig(deck.ankiDeckName);
    if (!config) return { ...base, ok: false, error: 'Anki could not find this deck or its preset.' };
    let state = deck.state;
    if (!state) {
      const originalConfigId = config.id;
      const name = managedConfigName(deck.deckName);
      const clonedId = await client.cloneDeckConfigId(name, originalConfigId);
      if (clonedId === false) return { ...base, ok: false, error: 'Anki could not create an isolated adaptive preset.' };
      if (!await client.setDeckConfigId([deck.ankiDeckName], clonedId)) {
        return { ...base, ok: false, error: 'Anki could not assign the isolated adaptive preset.' };
      }
      state = {
        originalConfigId: String(originalConfigId),
        managedConfigId: String(clonedId),
        managedConfigName: name,
      };
      config = await client.getDeckConfig(deck.ankiDeckName);
      if (!config || config.id !== clonedId) {
        return { ...base, ok: false, state, error: 'The adaptive preset assignment could not be verified.' };
      }
    } else {
      const expectedId = configId(state.managedConfigId);
      if (expectedId === null || config.id !== expectedId) {
        return {
          ...base,
          ok: false,
          state,
          error: 'This deck now uses a different preset. Hyperlearning did not overwrite it.',
        };
      }
    }
    const updated: AnkiDeckConfig = {
      ...config,
      new: { ...config.new, perDay: deck.budget },
    };
    if (!await client.saveDeckConfig(updated)) {
      return { ...base, ok: false, state, error: 'Anki rejected the adaptive new-card limit.' };
    }
    return { ...base, ok: true, state };
  } catch (error) {
    return { ...base, ok: false, error: error instanceof Error ? error.message : 'Anki could not apply the adaptive limit.' };
  }
}

export async function applyAdaptiveBudgetToAnki(input: {
  budget: number;
  decks: AdaptiveDeckInput[];
  client?: AdaptiveAnkiClient;
}): Promise<AdaptiveDeckApplicationResult[]> {
  const client = input.client ?? adaptiveAnkiClient;
  let availableDeckNames: string[];
  try {
    availableDeckNames = await client.deckNames();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Anki could not list decks.';
    return input.decks.map((deck) => ({
      mappingId: deck.mappingId,
      deckName: deck.deckName,
      availableNew: 0,
      budget: 0,
      ok: false,
      error: message,
    }));
  }
  const capacities = await Promise.all(input.decks.map(async (deck) => {
    const ankiDeckName = availableDeckNames.includes(deck.deckName)
      ? deck.deckName
      : nestedDeckFallback(deck.deckName, availableDeckNames);
    if (!ankiDeckName) {
      return { ...deck, ankiDeckName: deck.deckName, availableNew: 0, capacityError: 'Anki could not find this deck.' };
    }
    try {
      return { ...deck, ankiDeckName, availableNew: await client.newCardCount(ankiDeckName), capacityError: null as string | null };
    } catch (error) {
      return {
        ...deck,
        ankiDeckName,
        availableNew: 0,
        capacityError: error instanceof Error ? error.message : 'Anki could not count new cards.',
      };
    }
  }));
  const allocation = allocateAdaptiveBudget(input.budget, capacities);
  const byMapping = new Map(allocation.map((item) => [item.mappingId, item]));
  const results: AdaptiveDeckApplicationResult[] = [];
  for (const deck of capacities) {
    const assigned = byMapping.get(deck.mappingId)!;
    if (deck.capacityError) {
      results.push({
        mappingId: deck.mappingId,
        deckName: deck.deckName,
        availableNew: 0,
        budget: 0,
        ok: false,
        error: deck.capacityError,
      });
      continue;
    }
    results.push(await applyDeck({ ...deck, budget: assigned.budget }, client));
  }
  return results;
}

export async function restoreAdaptiveDeckPreset(input: {
  deckName: string;
  state: AdaptiveDeckState;
  client?: AdaptiveAnkiClient;
}): Promise<{ ok: boolean; error?: string }> {
  const client = input.client ?? adaptiveAnkiClient;
  try {
    const availableDeckNames = await client.deckNames();
    const ankiDeckName = availableDeckNames.includes(input.deckName)
      ? input.deckName
      : nestedDeckFallback(input.deckName, availableDeckNames);
    if (!ankiDeckName) return { ok: false, error: 'Anki could not find this deck.' };
    const current = await client.getDeckConfig(ankiDeckName);
    if (!current) return { ok: false, error: 'Anki could not find this deck.' };
    const managedId = configId(input.state.managedConfigId);
    const originalId = configId(input.state.originalConfigId);
    if (managedId === null || originalId === null) return { ok: false, error: 'Stored preset identifiers are invalid.' };
    if (current.id !== managedId) {
      return { ok: false, error: 'The deck preset changed manually, so Hyperlearning left it untouched.' };
    }
    return await client.setDeckConfigId([ankiDeckName], originalId)
      ? { ok: true }
      : { ok: false, error: 'Anki rejected the original preset restoration.' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Anki could not restore the original preset.' };
  }
}
