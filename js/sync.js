// Optional progress sync across devices through one private GitHub Gist. It does nothing until a token is pasted in
// Settings. This is the app's only network call outside its own site: it talks to api.github.com alone. The token is
// kept in this device's storage under its own key, apart from the progress, so it is never in an export code.
// Syncing never overwrites: it fetches the other devices' copy, merges it into this one (store.mergeProgress) and
// uploads the result. Any failure (offline, a bad token) leaves progress untouched and leaves a calm note in Settings.
// Opt-in from Today's words: the same gist also holds today's words (WIDGET_FILE) for the home screen widget, which
// reads that one file by its link (a secret gist's raw link needs no token, so the token never leaves this device).
import { store, mergeProgress, STATE_VERSION } from './store.js';
import { widgetFeed, WIDGET_FILE } from './daily-words.js';

const KEY = 'kotobaBeat.sync';
export const API = 'https://api.github.com';
export const GIST_FILE = 'kotoba-beat-progress.json';
/** Automatic syncs (tab shown again, a screen finished) wait at least this long after the last try. */
const AUTO_GAP = 20_000;

const blankCfg = () => ({ token: '', gistId: '', lastSync: 0, note: '', widget: false, widgetUrl: '' });
let cfg = loadCfg();
let running = null;
let lastTry = 0;
const statusListeners = new Set();
const changeListeners = new Set();

function loadCfg() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (c && typeof c === 'object') {
      return {
        token: typeof c.token === 'string' ? c.token : '',
        gistId: typeof c.gistId === 'string' && /^[0-9a-f]+$/i.test(c.gistId) ? c.gistId : '',
        lastSync: Number(c.lastSync) || 0,
        note: typeof c.note === 'string' ? c.note : '',
        widget: c.widget === true,
        widgetUrl: typeof c.widgetUrl === 'string' && c.widgetUrl.startsWith('https://gist.githubusercontent.com/') ? c.widgetUrl : '',
      };
    }
  } catch (e) { /* private mode or damaged: not connected */ }
  return blankCfg();
}

function saveCfg() {
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { /* storage blocked: this visit only */ }
  emitStatus();
}

function emitStatus() { statusListeners.forEach((fn) => { try { fn(status()); } catch (e) { /* ignore */ } }); }

/** What Settings shows. Never includes the token. */
export function status() {
  return { connected: !!cfg.token, gistId: cfg.gistId, lastSync: cfg.lastSync, note: cfg.note, busy: !!running, widget: cfg.widget, widgetUrl: cfg.widget ? cfg.widgetUrl : '' };
}
export function onStatus(fn) { statusListeners.add(fn); return () => statusListeners.delete(fn); }
/** Called after a sync brought in progress from another device. */
export function onChange(fn) { changeListeners.add(fn); return () => changeListeners.delete(fn); }

class SyncError extends Error {
  constructor(kind) { super(kind); this.kind = kind; }
}

const NOTES = {
  offline: 'Couldn\'t reach GitHub just now (offline?). Your progress is saved on this device and will sync next time.',
  token: 'GitHub didn\'t accept the token. It may have expired or be missing the Gists permission. Your progress is safe on this device; paste a new token to keep syncing.',
  rate: 'GitHub asked the app to slow down. It will try again later; nothing is lost.',
  server: 'GitHub had a hiccup. The app will try again next time; nothing is lost.',
  newer: 'Another device synced with a newer version of Kotoba Beat. Close and reopen the app here to update it, then sync again.',
  data: 'The synced copy on GitHub couldn\'t be read, so it was left as it is. Your progress on this device is safe.',
};

async function api(path, { method = 'GET', body = null } = {}) {
  const payload = body ? JSON.stringify(body) : undefined;
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + cfg.token,
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
      },
      body: payload,
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch (e) {
    throw new SyncError('offline');
  }
  if (res.status === 401) throw new SyncError('token');
  if (res.status === 403 || res.status === 429) throw new SyncError(res.headers.get('x-ratelimit-remaining') === '0' || res.status === 429 ? 'rate' : 'token');
  if (res.status === 404) throw new SyncError('missing');
  if (!res.ok) throw new SyncError('server');
  try { return await res.json(); } catch (e) { throw new SyncError('server'); }
}

/** Looks through the account's gists for one holding the progress file (made by another device). */
async function findGist() {
  for (let page = 1; page <= 10; page++) {
    const list = await api(`/gists?per_page=100&page=${page}`);
    if (!Array.isArray(list)) return '';
    const hit = list.find((g) => g && g.files && g.files[GIST_FILE]);
    if (hit) return String(hit.id);
    if (list.length < 100) return '';
  }
  return '';
}

/** The progress in the gist, or null if the gist has no progress file yet. */
async function readRemote(gist) {
  const file = gist && gist.files && gist.files[GIST_FILE];
  if (!file) return null;
  let text = file.content;
  if (file.truncated) {
    // Over 1 MB GitHub sends only part of the file. Its raw copy needs no token, so none is sent.
    const url = new URL(file.raw_url);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.githubusercontent.com')) throw new SyncError('data');
    try { text = await (await fetch(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })).text(); } catch (e) { throw new SyncError('offline'); }
  }
  if (!text || !text.trim()) return null;
  let obj;
  try { obj = JSON.parse(text); } catch (e) { throw new SyncError('data'); }
  const data = obj && obj.app === 'kotoba-beat' && obj.data ? obj.data : obj;
  if (!data || typeof data !== 'object' || typeof data.items !== 'object') throw new SyncError('data');
  // Progress saved by a newer app could carry fields this version doesn't know: merging would drop them.
  if (Number(data.v) > STATE_VERSION) throw new SyncError('newer');
  return data;
}

/** The widget file's link without its version, so it always gives the newest copy. */
function latestRawUrl(gist) {
  const login = gist && gist.owner && gist.owner.login;
  if (login && /^[A-Za-z0-9-]+$/.test(login)) return `https://gist.githubusercontent.com/${login}/${gist.id}/raw/${WIDGET_FILE}`;
  const raw = gist && gist.files && gist.files[WIDGET_FILE] && gist.files[WIDGET_FILE].raw_url;
  const m = typeof raw === 'string' && /^https:\/\/gist\.githubusercontent\.com\/([^/]+)\/([0-9a-f]+)\/raw\//i.exec(raw);
  return m ? `https://gist.githubusercontent.com/${m[1]}/${m[2]}/raw/${WIDGET_FILE}` : '';
}

const fileContent = (data) => JSON.stringify({ app: 'kotoba-beat', v: STATE_VERSION, synced: new Date().toISOString(), data });

async function run() {
  let gist = null;
  if (cfg.gistId) {
    try { gist = await api('/gists/' + cfg.gistId); } catch (e) {
      if (e.kind !== 'missing') throw e;
      cfg.gistId = '';   // deleted on GitHub: look again, or make a new one
    }
  }
  if (!gist) {
    const id = await findGist();
    if (id) gist = await api('/gists/' + id);
  }

  const remote = gist ? await readRemote(gist) : null;
  let changed = false;
  if (remote) {
    // No await between reading this device's progress and putting the merge in place, so nothing studied is missed.
    const before = JSON.stringify(store.syncData());
    const merged = mergeProgress(store.s, remote);
    const { settings, ...data } = merged;
    if (JSON.stringify(data) !== before) { store.applySynced(merged); changed = true; }
  }

  const data = store.syncData();
  const widget = cfg.widget ? widgetFeed() : null;
  const hasWidget = !!(gist && gist.files && gist.files[WIDGET_FILE]);
  let saved = gist;
  if (!gist) {
    const files = { [GIST_FILE]: { content: fileContent(data) } };
    if (widget) files[WIDGET_FILE] = { content: widget };
    const made = await api('/gists', {
      method: 'POST',
      body: { description: 'Kotoba Beat progress (synced by the app; private)', public: false, files },
    });
    if (!made || !made.id) throw new SyncError('server');
    cfg.gistId = String(made.id);
    saved = made;
  } else {
    cfg.gistId = String(gist.id);
    const files = {};
    if (!remote || JSON.stringify(data) !== JSON.stringify(remote)) files[GIST_FILE] = { content: fileContent(data) };
    if (widget && (!hasWidget || gist.files[WIDGET_FILE].content !== widget)) files[WIDGET_FILE] = { content: widget };
    if (!widget && hasWidget) files[WIDGET_FILE] = null;   // the widget was turned off: its file goes
    if (Object.keys(files).length) saved = await api('/gists/' + cfg.gistId, { method: 'PATCH', body: { files } }) || gist;
  }
  if (widget) cfg.widgetUrl = latestRawUrl(saved) || latestRawUrl(gist) || cfg.widgetUrl;
  cfg.lastSync = Date.now();
  cfg.note = '';
  saveCfg();
  if (changed) changeListeners.forEach((fn) => { try { fn(); } catch (e) { /* ignore */ } });
  return true;
}

/**
 * Syncs now. Resolves true when synced, false when not connected, skipped or failed (with a note in Settings).
 * Never rejects, so callers never need to handle an error. Automatic calls are spaced out; `force` skips that.
 */
export function sync({ force = false } = {}) {
  if (!cfg.token) return Promise.resolve(false);
  if (running) return running;
  if (!force && Date.now() - lastTry < AUTO_GAP) return Promise.resolve(false);
  lastTry = Date.now();
  running = run().catch((e) => {
    cfg.note = NOTES[e && e.kind] || NOTES.server;
    saveCfg();
    return false;
  }).finally(() => { running = null; emitStatus(); });
  emitStatus();
  return running;
}

/** Fine-grained tokens start github_pat_, classic ones ghp_. Only the shape is checked here; GitHub checks the rest. */
export function looksLikeToken(t) { return /^(github_pat_|gh[pousr]_)[A-Za-z0-9_]{20,}$/.test(t); }

/** Saves the token on this device and syncs: finds the existing gist by its file name, or makes one. */
export function connect(token) {
  cfg = { ...blankCfg(), token: String(token || '').trim() };
  saveCfg();
  return sync({ force: true });
}

/** Turns the home screen widget's feed on or off, and syncs so the gist matches. */
export function setWidget(on) {
  cfg.widget = !!on;
  saveCfg();
  return sync({ force: true });
}

/** Forgets the token and the gist id on this device. The gist itself stays on GitHub. */
export function disconnect() {
  cfg = blankCfg();
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  emitStatus();
}

let started = false;
/** Wires the automatic syncs: now (the app opened), when the app comes back into view, when it's hidden, and when a
 *  Today block is finished. Screens call sync() themselves when a session ends. */
export function init() {
  if (started) return;
  started = true;
  sync({ force: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') sync({ force: true });
    else sync();   // a Home Screen app resumes without reloading: that counts as opening it
  });
  store.onMilestone(() => sync({ force: true }));
}
