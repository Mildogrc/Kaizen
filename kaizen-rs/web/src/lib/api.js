// API client + a small stale-while-revalidate cache. Views render cached data
// instantly on revisit and refresh in the background; any mutation marks the
// whole cache stale and refetches only what is on screen.
import { createEffect, createSignal, onCleanup } from 'solid-js';

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export async function api(path, { method = 'GET', body, signal, raw = false } = {}) {
  const init = { method, headers: {}, credentials: 'same-origin', signal };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api${path}`, init);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Kaizen is unreachable. Check that the server is running.', 0);
  }
  if (res.status === 401) {
    onUnauthorized();
    throw new ApiError('Sign in to continue.', 401);
  }
  if (raw) {
    if (!res.ok) throw new ApiError(`Request failed (${res.status})`, res.status);
    return res;
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status, data);
  return data;
}

const STALE_MS = 3000;
const cache = new Map();

function entry(key) {
  let e = cache.get(key);
  if (!e) {
    e = { data: undefined, error: null, at: 0, inflight: null, listeners: new Set() };
    cache.set(key, e);
  }
  return e;
}

const notify = (e) => e.listeners.forEach((fn) => fn());

export function load(key) {
  const e = entry(key);
  if (!e.inflight) {
    e.inflight = api(key)
      .then((data) => { e.data = data; e.error = null; e.at = Date.now(); return data; })
      .catch((err) => { e.error = err; throw err; })
      .finally(() => { e.inflight = null; notify(e); });
    notify(e);
  }
  return e.inflight;
}

/** Warm the cache (e.g. on link hover) without subscribing. */
export function prefetch(key) {
  const e = entry(key);
  if (!e.inflight && (e.data === undefined || Date.now() - e.at > STALE_MS)) load(key).catch(() => {});
}

/** Mark everything stale; refetch views that are mounted. */
export function invalidate(match) {
  for (const [key, e] of cache) {
    if (match && !(typeof match === 'function' ? match(key) : key.startsWith(match))) continue;
    e.at = 0;
    if (e.listeners.size) load(key).catch(() => {});
  }
}

/** Optimistically replace cached data for a key. */
export function setCached(key, updater) {
  const e = entry(key);
  e.data = typeof updater === 'function' ? updater(e.data) : updater;
  notify(e);
}

/**
 * Subscribe to a GET endpoint. `keyFn` returns the path (or a falsy value to
 * pause). Returns accessors: data(), error(), loading(), refreshing().
 */
export function useApi(keyFn) {
  const [tick, setTick] = createSignal(0);
  createEffect(() => {
    const key = keyFn();
    if (!key) return;
    const e = entry(key);
    const update = () => setTick((t) => t + 1);
    e.listeners.add(update);
    if (e.data === undefined || Date.now() - e.at > STALE_MS) load(key).catch(() => {});
    onCleanup(() => e.listeners.delete(update));
  });
  // Read through the current key so data() always matches key().
  const read = (fn) => () => {
    tick();
    const key = keyFn();
    return key ? fn(entry(key)) : undefined;
  };
  return {
    key: keyFn,
    data: read((e) => e.data),
    error: read((e) => (e.data === undefined ? e.error : null)),
    loading: read((e) => e.data === undefined && !e.error),
    refreshing: read((e) => !!e.inflight),
    refetch: () => { const key = keyFn(); return key ? load(key) : Promise.resolve(); },
  };
}

/** Run a mutation, then revalidate what is on screen. */
export async function mutate(method, path, body, { refresh = true } = {}) {
  const data = await api(path, { method, body });
  if (refresh) invalidate();
  return data;
}

export const post = (path, body, opts) => mutate('POST', path, body, opts);
export const put = (path, body, opts) => mutate('PUT', path, body, opts);
export const patch = (path, body, opts) => mutate('PATCH', path, body, opts);
export const del = (path, opts) => mutate('DELETE', path, undefined, opts);
