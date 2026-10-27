import { createSignal } from 'solid-js';
import { post } from '../lib/api';
import { toast } from '../lib/store';
import { Icon } from './icons';
import { cx } from './ui';

export function AnkiSyncButton(props) {
  const [busy, setBusy] = createSignal(false);
  const sync = async () => {
    setBusy(true);
    try {
      const r = await post('/anki/sync');
      if (r.ok) toast(`Synced ${r.decksSynced} decks · ${r.cardsSynced.toLocaleString()} cards · ${r.reviewsAdded} new reviews`, 'good');
      else toast(r.error ?? 'Anki sync failed.', 'bad');
    } catch (err) {
      toast(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button class={cx('btn', props.small && 'btn-sm', props.class)} onClick={sync} disabled={busy()}>
      <Icon name="sync" size={14} class={busy() ? 'animate-spin' : ''} />
      {busy() ? 'Syncing…' : props.label ?? 'Sync Anki'}
    </button>
  );
}
