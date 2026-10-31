import { For, Show, createSignal } from 'solid-js';
import { useApi } from '../lib/api';
import { date, num } from '../lib/format';
import { AnkiSyncButton } from '../components/AnkiSync';
import { Empty, Load, Page, Section } from '../components/ui';

const TONE_NAMES = ['', '1st', '2nd', '3rd', '4th', 'neutral'];

export default function Pronunciation() {
  const q = useApi(() => '/chinese/pronunciation');
  const [playing, setPlaying] = createSignal(null);
  let audio;
  const play = (entry) => {
    audio?.pause();
    audio = new Audio(`/api/anki/media?file=${encodeURIComponent(entry.audioFilename)}`);
    setPlaying(entry.ankiCardId);
    audio.onended = () => setPlaying(null);
    audio.play().catch(() => setPlaying(null));
  };
  return (
    <Load q={q}>
      {(d) => (
        <Page title="Pronunciation" glyph="声" back={{ href: '/chinese', label: 'Chinese' }}
          subtitle="Mandarin tone pairs drawn from two-syllable words you’ve reviewed in Anki" actions={<AnkiSyncButton />}>
          <Section title="Tone pairs" actions={<span class="text-[11.5px] text-muted">Next rotation {date(d.nextRotation)}</span>}>
            <Show when={!d.unavailable} fallback={<Empty>Start Anki with AnkiConnect, then reload to load your reviewed vocabulary and audio.</Empty>}>
              <Show when={d.reviewed} fallback={<Empty>No reviewed Mandarin vocabulary synced yet. Review in Anki, then sync.</Empty>}>
                <p class="mb-3 text-[12.5px] text-muted">{num(d.candidates)} reviewed two-syllable words cover {d.filled} of 20 tone pairs. Click a word to hear it; the selection rotates every three days.</p>
                <div class="overflow-x-auto">
                  <table class="w-full min-w-[640px] border-separate border-spacing-1.5 text-[12.5px]">
                    <thead><tr><th />{[1, 2, 3, 4, 5].map((b) => <th class="text-[11px] font-medium text-muted">{TONE_NAMES[b]}</th>)}</tr></thead>
                    <tbody>
                      <For each={[1, 2, 3, 4]}>
                        {(a) => (
                          <tr>
                            <th class="pr-1 text-right text-[11px] font-medium text-muted">{TONE_NAMES[a]}</th>
                            <For each={[1, 2, 3, 4, 5]}>
                              {(b) => {
                                const entry = () => d.entries[`${a}-${b}`];
                                return (
                                  <td class="align-top">
                                    <Show when={entry()} fallback={<div class="flex h-[76px] items-center justify-center rounded-lg border border-dashed border-line text-faint">—</div>}>
                                      <button class={`flex h-[76px] w-full flex-col items-center justify-center rounded-lg border px-1.5 transition-colors ${playing() === entry().ankiCardId ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-line-strong'}`}
                                        onClick={() => play(entry())} title={entry().definition}>
                                        <span class="text-[19px]">{entry().word}</span>
                                        <span class="text-[11px] text-muted">{entry().syllables.map((s) => s.pinyin).join(' ')}</span>
                                        <span class="w-full truncate text-[10px] text-faint">{entry().definition}</span>
                                      </button>
                                    </Show>
                                  </td>
                                );
                              }}
                            </For>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </Show>
            </Show>
          </Section>
        </Page>
      )}
    </Load>
  );
}
