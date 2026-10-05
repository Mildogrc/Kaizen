import { describe, expect, it, vi } from 'vitest';
import {
  applyAdaptiveBudgetToAnki,
  restoreAdaptiveDeckPreset,
  type AdaptiveAnkiClient,
} from '../src/lib/adaptive-anki-application';
import type { AnkiDeckConfig } from '../src/lib/anki-connect';

function client(configs: Record<string, AnkiDeckConfig>, capacities: Record<string, number>): AdaptiveAnkiClient {
  let nextId = 100;
  return {
    deckNames: vi.fn(async () => Object.keys(configs)),
    getDeckConfig: vi.fn(async (deck) => configs[deck] ?? false),
    saveDeckConfig: vi.fn(async (config) => {
      const deck = Object.keys(configs).find((name) => configs[name].id === config.id);
      if (deck) configs[deck] = config;
      return true;
    }),
    cloneDeckConfigId: vi.fn(async () => nextId++),
    setDeckConfigId: vi.fn(async (decks, configId) => {
      for (const deck of decks) configs[deck] = { ...configs[deck], id: configId };
      return true;
    }),
    newCardCount: vi.fn(async (deck) => capacities[deck] ?? 0),
  };
}

function config(id: number): AnkiDeckConfig {
  return { id, name: `preset-${id}`, new: { perDay: 20, order: 1 }, rev: { perDay: 200 } };
}

describe('adaptive Anki application', () => {
  it('isolates selected decks and changes only the new-card limit', async () => {
    const configs = { Vocabulary: config(1), Unrelated: config(1) };
    const mock = client(configs, { Vocabulary: 50 });
    const [result] = await applyAdaptiveBudgetToAnki({
      budget: 10,
      decks: [{ mappingId: 'vocab', deckName: 'Vocabulary', state: null }],
      client: mock,
    });
    expect(result).toMatchObject({ ok: true, budget: 10, state: { originalConfigId: '1', managedConfigId: '100' } });
    expect(configs.Vocabulary.new).toEqual({ perDay: 10, order: 1 });
    expect(configs.Vocabulary.rev).toEqual({ perDay: 200 });
    expect(configs.Unrelated).toEqual(config(1));
  });

  it('allocates one total budget across multiple selected decks', async () => {
    const configs = { A: config(10), B: config(20) };
    const mock = client(configs, { A: 20, B: 5 });
    const results = await applyAdaptiveBudgetToAnki({
      budget: 10,
      decks: [
        { mappingId: 'a', deckName: 'A', state: { originalConfigId: '1', managedConfigId: '10', managedConfigName: 'A' } },
        { mappingId: 'b', deckName: 'B', state: { originalConfigId: '2', managedConfigId: '20', managedConfigName: 'B' } },
      ],
      client: mock,
    });
    expect(results.map((result) => result.budget)).toEqual([8, 2]);
  });

  it('resolves a uniquely nested Anki deck name', async () => {
    const configs = { '日本語::AnimeDeck': config(1), Unrelated: config(1) };
    const mock = client(configs, { '日本語::AnimeDeck': 30 });
    const [result] = await applyAdaptiveBudgetToAnki({
      budget: 10,
      decks: [{ mappingId: 'anime', deckName: 'AnimeDeck', state: null }],
      client: mock,
    });
    expect(result).toMatchObject({ ok: true, deckName: 'AnimeDeck', availableNew: 30, budget: 10 });
    expect(configs['日本語::AnimeDeck'].new.perDay).toBe(10);
  });

  it('refuses to overwrite a manually changed preset', async () => {
    const configs = { Vocabulary: config(99) };
    const mock = client(configs, { Vocabulary: 20 });
    const [result] = await applyAdaptiveBudgetToAnki({
      budget: 10,
      decks: [{
        mappingId: 'vocab', deckName: 'Vocabulary',
        state: { originalConfigId: '1', managedConfigId: '100', managedConfigName: 'managed' },
      }],
      client: mock,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('different preset');
    expect(mock.saveDeckConfig).not.toHaveBeenCalled();
  });

  it('restores the original preset only while the managed preset is active', async () => {
    const configs = { Vocabulary: config(100) };
    const mock = client(configs, {});
    await expect(restoreAdaptiveDeckPreset({
      deckName: 'Vocabulary',
      state: { originalConfigId: '1', managedConfigId: '100', managedConfigName: 'managed' },
      client: mock,
    })).resolves.toEqual({ ok: true });
    expect(configs.Vocabulary.id).toBe(1);
  });

  it('fails safely when Anki is unavailable', async () => {
    const mock = client({ Vocabulary: config(1) }, { Vocabulary: 20 });
    mock.newCardCount = vi.fn(async () => { throw new Error('Anki unavailable'); });
    const [result] = await applyAdaptiveBudgetToAnki({
      budget: 10,
      decks: [{ mappingId: 'vocab', deckName: 'Vocabulary', state: null }],
      client: mock,
    });
    expect(result).toMatchObject({ ok: false, budget: 0, error: 'Anki unavailable' });
    expect(mock.saveDeckConfig).not.toHaveBeenCalled();
  });
});
