import './app.css';
import { Route, Router } from '@solidjs/router';
import { Match, Switch, lazy, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { Layout } from './components/Layout';
import { session } from './lib/store';
import Login from './pages/Login';

// After a deploy, an open tab may ask for page chunks that no longer exist.
// Reload once to pick up the new build instead of failing silently.
const page = (load) =>
  lazy(() =>
    load().catch((err) => {
      const key = 'kaizen.chunk-reload';
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        location.reload();
        return new Promise(() => {});
      }
      throw err;
    }),
  );
window.addEventListener('load', () => setTimeout(() => sessionStorage.removeItem('kaizen.chunk-reload'), 5000));
const routes = [
  ['/', page(() => import('./pages/Dashboard'))],
  ['/daily', page(() => import('./pages/Daily'))],
  ['/review', page(() => import('./pages/Review'))],
  ['/japanese', page(() => import('./pages/Course'))],
  ['/chinese', page(() => import('./pages/Course'))],
  ['/japanese/grammar', page(() => import('./pages/Grammar'))],
  ['/japanese/kanji-repair', page(() => import('./pages/KanjiRepair'))],
  ['/chinese/mandarin-blueprint', page(() => import('./pages/Mandarin'))],
  ['/chinese/pronunciation', page(() => import('./pages/Pronunciation'))],
  ['/math', page(() => import('./pages/Math'))],
  ['/concepts', page(() => import('./pages/Concepts'))],
  ['/concepts/:id', page(() => import('./pages/Concept'))],
  ['/skills', page(() => import('./pages/Skills'))],
  ['/nato', page(() => import('./pages/Nato'))],
  ['/codeforces', page(() => import('./pages/Codeforces'))],
  ['/speed-reading', page(() => import('./pages/SpeedReading'))],
  ['/youtube', page(() => import('./pages/YouTube'))],
  ['/youtube/:id', page(() => import('./pages/YouTubeDetail'))],
  ['/books', page(() => import('./pages/Books'))],
  ['/books/:id', page(() => import('./pages/BookDetail'))],
  ['/mistakes', page(() => import('./pages/Mistakes'))],
  ['/analytics', page(() => import('./pages/Analytics'))],
  ['/words', page(() => import('./pages/Words'))],
  ['/anki', page(() => import('./pages/Anki'))],
  ['/import', page(() => import('./pages/Import'))],
  ['/schemas', page(() => import('./pages/Schemas'))],
  ['/schemas/new', page(() => import('./pages/SchemaNew'))],
  ['/schemas/:slug', page(() => import('./pages/SchemaDetail'))],
  ['/configurations', page(() => import('./pages/Configurations'))],
  ['/settings', page(() => import('./pages/Settings'))],
];
const NotFound = page(() => import('./pages/NotFound'));

function Shell(props) {
  onMount(() => session.refresh());
  return (
    <Switch>
      <Match when={session.me() === undefined}>
        <div class="flex min-h-dvh items-center justify-center"><div class="ai-orb idle" /></div>
      </Match>
      <Match when={session.me() === null}><Login /></Match>
      <Match when={session.me()}><Layout>{props.children}</Layout></Match>
    </Switch>
  );
}

render(
  () => (
    <Router root={Shell}>
      {routes.map(([path, component]) => <Route path={path} component={component} />)}
      <Route path="/login" component={() => { location.replace('/'); return null; }} />
      <Route path="*404" component={NotFound} />
    </Router>
  ),
  document.getElementById('app'),
);
