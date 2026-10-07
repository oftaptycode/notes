import { openDB, type DBSchema } from 'idb';
import { supabase } from './supabase';
import type { NoteBackground } from './noteBackground';
import {
  isMood, parseMoodProbabilities, hasEnoughMoodContent, MAX_MOOD_CONTENT_LENGTH, MOOD_MODEL, MOOD_VERSION, LEGACY_MOOD_VERSION,
  type Mood, type MoodProbability,
} from '../supabase/functions/_shared/moods';

interface CachedMood {
  key: string;
  content: string;
  mood: Mood;
  probabilities?: MoodProbability[];
  analyzedAt: number;
}
interface MoodCache extends DBSchema {
  results: { key: string; value: CachedMood };
}
let cacheDB: ReturnType<typeof openDB<MoodCache>> | undefined;
function getCacheDB() {
  return cacheDB ??= openDB<MoodCache>('notes-mood-cache', 1, {
    upgrade(db) { db.createObjectStore('results', { keyPath: 'key' }); },
  }).catch((error) => { cacheDB = undefined; throw error; });
}

type DisplayState = 'fresh' | 'updating' | 'stale' | 'offline' | 'unavailable' | 'signin';
interface Snapshot { id: string; content: string; userId: string; generation: number; key: string }

export function createMoodController(element: HTMLElement, distribution: HTMLElement, background?: NoteBackground) {
  let note: { id: string; content: string; openedContent: string } | null = null;
  let userId: string | null = null;
  let cached: CachedMood | null = null;
  let generation = 0;
  let request: AbortController | null = null;
  let attempted = false;
  const memory = new Map<string, CachedMood | null>();
  const keyFor = (id: string, user: string, version = MOOD_VERSION) => `${MOOD_MODEL}:${version}:${user}:${id}`;

  function hide() {
    background?.setMood(null);
    element.hidden = true;
    element.textContent = '';
    distribution.hidden = true;
    distribution.textContent = '';
  }

  function cancel() {
    generation++;
    request?.abort();
    request = null;
  }
  function isCurrent(snapshot: Snapshot) {
    return snapshot.generation === generation && snapshot.userId === userId
      && snapshot.id === note?.id;
  }
  function render(state: DisplayState, reason = '') {
    if (!note || !hasEnoughMoodContent(note.content)) { hide(); return; }
    background?.setMood(cached?.mood ?? null, cached?.probabilities);
    element.hidden = false;
    element.dataset.state = state;
    const text = cached?.mood ?? (state === 'updating' ? 'Detecting…'
      : state === 'offline' ? 'Mood offline'
      : state === 'stale' ? 'Reopen for mood'
      : state === 'signin' ? 'Sign in for mood' : 'Mood unavailable');
    if (element.textContent !== text) element.textContent = text;
    element.setAttribute('aria-busy', String(state === 'updating'));
    element.setAttribute('aria-label', state === 'fresh' ? `Mood: ${text}`
      : cached ? `Mood: ${text}, outdated. ${reason}` : text);
    element.title = reason || (state === 'fresh'
      ? 'Detected emotional atmosphere of this note, not a judgment about you.'
      : state === 'stale' ? 'The note has changed. Reopen it to update the mood.'
      : 'Detecting the mood of the note as it was when opened.');
    distribution.dataset.state = state;
    distribution.hidden = false;
    if (cached?.probabilities) {
      const visible = cached.probabilities.filter(entry => Math.round(entry.probability * 100) > 0);
      distribution.hidden = visible.length === 0;
      const text = visible.map(entry => `${entry.value} (${Math.round(entry.probability * 100)}%)`).join(', ');
      if (distribution.textContent !== text) {
        const fragments = document.createDocumentFragment();
        visible.forEach((entry, index) => {
          if (index) fragments.append(document.createTextNode(', '));
          const item = document.createElement('span');
          item.className = 'mood-probability';
          item.textContent = `${entry.value} (${Math.round(entry.probability * 100)}%)`;
          item.title = `Returned probability: ${entry.probability}`;
          fragments.append(item);
        });
        distribution.replaceChildren(fragments);
      }
      distribution.title = 'Mood-choice probabilities before the separate emotional-tone check. Entries rounding to 0% are hidden; rounded percentages may not total exactly 100%.';
      if (state !== 'fresh') distribution.title += ' This distribution is outdated or being refreshed.';
    } else {
      distribution.textContent = state === 'updating' ? 'Fetching mood probabilities…'
        : cached ? 'Probability breakdown unavailable — update the mood service and reopen this note.'
        : 'Mood probabilities unavailable.';
      distribution.title = element.title;
    }
  }

  async function loadCached(snapshot: Snapshot) {
    if (memory.has(snapshot.key)) return memory.get(snapshot.key) ?? null;
    let result: CachedMood | null = null;
    try {
      const db = await getCacheDB();
      const legacyKey = keyFor(snapshot.id, snapshot.userId, LEGACY_MOOD_VERSION);
      const record = await db.get('results', snapshot.key) ?? await db.get('results', legacyKey);
      if (record && (record.key === snapshot.key || record.key === legacyKey)
        && typeof record.content === 'string' && isMood(record.mood)) {
        result = { ...record, key: snapshot.key, probabilities: parseMoodProbabilities(record.probabilities) ?? undefined };
      }
    } catch { /* Mood caching must never interfere with note saving. */ }
    if (isCurrent(snapshot)) memory.set(snapshot.key, result);
    return result;
  }

  function renderCached() {
    render(cached?.content === note?.content ? 'fresh' : 'stale');
  }

  async function prepare(snapshot: Snapshot, allowAnalysis: boolean) {
    const result = await loadCached(snapshot);
    if (!isCurrent(snapshot)) return;
    cached = result;
    if (!allowAnalysis || (cached?.content === snapshot.content && cached.probabilities)) { renderCached(); return; }
    if (!navigator.onLine) { render('offline', 'Reconnect and reopen this note to detect mood.'); return; }
    if (snapshot.content.length > MAX_MOOD_CONTENT_LENGTH) {
      render('unavailable', 'This note is too long to analyze (maximum 50,000 characters).');
      return;
    }
    if (document.visibilityState === 'hidden') {
      render('unavailable', 'Reopen this note while the app is visible to detect mood.');
      return;
    }
    await analyze(snapshot);
  }

  async function analyze(snapshot: Snapshot) {
    if (!isCurrent(snapshot) || !supabase) return;
    if (!hasEnoughMoodContent(snapshot.content)) { hide(); return; }
    if (!navigator.onLine) { render('offline', 'Reconnect and reopen this note to detect mood.'); return; }
    if (document.visibilityState === 'hidden') return;
    const controller = new AbortController();
    request = controller;
    render('updating');
    try {
      const { data, error } = await supabase.functions.invoke('note-mood', {
        body: { content: snapshot.content }, signal: controller.signal, timeout: 25_000,
      });
      if (!isCurrent(snapshot) || controller.signal.aborted) return;
      if (error) {
        // FunctionsHttpError exposes the Response as context. Never display
        // arbitrary provider bodies; the server returns only short safe errors.
        const context = (error as { context?: unknown }).context;
        let reason = 'Mood detection is temporarily unavailable.';
        const status = context instanceof Response ? context.status : 0;
        if (context instanceof Response) {
          try {
            const body = await context.json();
            if (typeof body?.error === 'string') reason = body.error.slice(0, 200);
          } catch { /* Keep the generic message. */ }
        }
        if (!isCurrent(snapshot)) return;
        if (status === 401) {
          render('signin', 'Sign in again and reopen this note to detect mood.');
          return;
        }
        render(navigator.onLine ? 'unavailable' : 'offline', reason);
        return;
      }
      if (!data || !isMood(data.mood) || data.model !== MOOD_MODEL
        || (data.version !== MOOD_VERSION && data.version !== LEGACY_MOOD_VERSION)) {
        throw new Error('Invalid mood response.');
      }
      const probabilities = parseMoodProbabilities(data.probabilities);
      if (data.version === MOOD_VERSION && !probabilities) throw new Error('Invalid mood probability distribution.');
      const record: CachedMood = {
        key: snapshot.key, content: snapshot.content, mood: data.mood,
        probabilities: probabilities ?? undefined, analyzedAt: Date.now(),
      };
      cached = record;
      memory.set(snapshot.key, record);
      // The one opening-time request may finish after typing starts. Its label
      // still belongs to this opening snapshot, so mark it outdated if needed.
      renderCached();
      // Derived metadata only: no updates to note content, timestamps or sync flags.
      void getCacheDB().then(db => db.put('results', record)).catch(() => {});
    } catch {
      if (!isCurrent(snapshot) || controller.signal.aborted) return;
      render(navigator.onLine ? 'unavailable' : 'offline', 'Mood detection is unavailable. Reopen the note to try again. Saving is unaffected.');
    } finally {
      if (request === controller) request = null;
    }
  }

  function begin(allowAnalysis = true) {
    if (!note || !hasEnoughMoodContent(note.openedContent)) {
      if (note && hasEnoughMoodContent(note.content)) render('stale');
      else hide();
      return;
    }
    if (!supabase) { render('unavailable', 'Configure Supabase and deploy note-mood to enable mood detection.'); return; }
    if (!userId) { render('signin', 'Sign in to analyze this note with OpenAI.'); return; }
    if (attempted) return;
    attempted = true;
    const snapshot: Snapshot = { id: note.id, content: note.openedContent, userId, generation, key: keyFor(note.id, userId) };
    cached = memory.get(snapshot.key) ?? null;
    render(cached?.content === snapshot.content ? 'fresh' : 'updating');
    void prepare(snapshot, allowAnalysis);
  }

  window.addEventListener('offline', () => {
    cancel();
    if (note?.content.trim() && userId) {
      render(cached?.content === note.content ? 'fresh' : 'offline',
        cached?.content === note.content ? 'Cached mood available offline.'
          : 'The last mood is kept offline. Reconnect and reopen the note to update it.');
    }
  });
  window.addEventListener('online', () => {
    if (note?.content.trim() && userId) renderCached();
  });

  return {
    openNote(id: string, content: string) {
      cancel();
      note = { id, content, openedContent: content };
      cached = null;
      attempted = false;
      begin();
    },
    updateContent(id: string, content: string) {
      if (note?.id !== id || note.content === content) return;
      note.content = content;
      if (!hasEnoughMoodContent(content)) { hide(); return; }
      if (!supabase) { render('unavailable', 'Configure Supabase and deploy note-mood to enable mood detection.'); return; }
      if (!userId) { render('signin', 'Sign in and reopen this note to detect mood.'); return; }
      // Editing never schedules a request or changes its opening-time input.
      if (request) render('updating');
      else renderCached();
    },
    setUser(id: string | null) {
      if (userId === id) return;
      cancel();
      userId = id;
      cached = null;
      attempted = false;
      // Initial auth can resolve after opening. Only start its first analysis
      // if the note has not since been edited; otherwise load cached metadata.
      begin(note?.content === note?.openedContent);
    },
    clear() {
      const key = note && userId ? keyFor(note.id, userId) : null;
      const legacyKey = note && userId ? keyFor(note.id, userId, LEGACY_MOOD_VERSION) : null;
      cancel();
      note = null;
      cached = null;
      hide();
      if (key) {
        memory.delete(key);
        void getCacheDB().then(async db => {
          await db.delete('results', key);
          if (legacyKey) await db.delete('results', legacyKey);
        }).catch(() => {});
      }
    },
  };
}
