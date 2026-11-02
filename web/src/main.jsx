import './app.css';
import { Route, Router, useLocation, useNavigate, useParams } from '@solidjs/router';
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
const redirect = (to) => () => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const target = typeof to === 'function' ? to(params) : to;
  navigate(`${target}${location.search}${location.hash}`, { replace: true });
  return null;
};
const routes = [
  ['/', page(() => import('./pages/Today'))],
  ['/review', page(() => import('./pages/Review'))],
  ['/tracks', page(() => import('./pages/Tracks'))],
  ['/tracks/math', page(() => import('./pages/Math'))],
  ['/tracks/nato', page(() => import('./pages/Nato'))],
  ['/tracks/codeforces', page(() => import('./pages/Codeforces'))],
  ['/tracks/speed-reading', page(() => import('./pages/SpeedReading'))],
  ['/tracks/reading', page(() => import('./pages/ReadingTrack'))],
  ['/tracks/japanese/grammar', page(() => import('./pages/Grammar'))],
  ['/tracks/japanese/character-repair', page(() => import('./pages/KanjiRepair'))],
  ['/tracks/chinese/mandarin-blueprint', page(() => import('./pages/Mandarin'))],
  ['/tracks/chinese/tones', page(() => import('./pages/Pronunciation'))],
  ['/tracks/:slug', page(() => import('./pages/Track'))],
  ['/concepts', page(() => import('./pages/Concepts'))],
  ['/concepts/:id', page(() => import('./pages/Concept'))],
  ['/library', page(() => import('./pages/YouTube'))],
  ['/library/courses/:id', page(() => import('./pages/YouTubeDetail'))],
  ['/library/books', page(() => import('./pages/Books'))],
  ['/library/books/:id', page(() => import('./pages/BookDetail'))],
  ['/library/imports', page(() => import('./pages/Import'))],
  ['/insights', page(() => import('./pages/Analytics'))],
  ['/insights/words', page(() => import('./pages/Words'))],
  ['/insights/mistakes', page(() => import('./pages/Mistakes'))],
  ['/settings', page(() => import('./pages/Settings'))],
  ['/settings/anki', page(() => import('./pages/Anki'))],
  ['/settings/data', page(() => import('./pages/SettingsData'))],
  ['/schemas', page(() => import('./pages/Schemas'))],
  ['/schemas/new', page(() => import('./pages/SchemaNew'))],
  ['/schemas/:slug', page(() => import('./pages/SchemaDetail'))],
  ['/configurations', page(() => import('./pages/Configurations'))],
  // Where things used to live, so old links and bookmarks keep working.
  ['/daily', redirect('/')],
  ['/skills', redirect('/tracks')],
  ['/japanese', redirect('/tracks/japanese')],
  ['/chinese', redirect('/tracks/chinese')],
  ['/japanese/grammar', redirect('/tracks/japanese/grammar')],
  ['/japanese/kanji-repair', redirect('/tracks/japanese/character-repair')],
  ['/chinese/mandarin-blueprint', redirect('/tracks/chinese/mandarin-blueprint')],
  ['/chinese/pronunciation', redirect('/tracks/chinese/tones')],
  ['/math', redirect('/tracks/math')],
  ['/nato', redirect('/tracks/nato')],
  ['/codeforces', redirect('/tracks/codeforces')],
  ['/speed-reading', redirect('/tracks/speed-reading')],
  ['/youtube', redirect('/library')],
  ['/youtube/:id', redirect((p) => `/library/courses/${p.id}`)],
  ['/books', redirect('/library/books')],
  ['/books/:id', redirect((p) => `/library/books/${p.id}`)],
  ['/import', redirect('/library/imports')],
  ['/analytics', redirect('/insights')],
  ['/words', redirect('/insights/words')],
  ['/mistakes', redirect('/insights/mistakes')],
  ['/anki', redirect('/settings/anki')],
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
