import { SearchIndex, type SearchItem, type SearchMessage, type SearchResult } from './searchIndex';

export function createSearch() {
  const content = new Map<string, string>();
  let worker: Worker | null = null;
  let fallback: SearchIndex | null = null;
  let started = false;
  let request = 0;
  const pending = new Map<number, { query: string; resolve: (ids: string[]) => void }>();
  const changes = new Map<string, string | null>();
  const items = () => [...content].map(([id, text]) => ({ id, content: text }));
  const send = (message: SearchMessage) => worker!.postMessage(message);

  function useFallback() {
    worker?.terminate();
    worker = null;
    fallback = new SearchIndex();
    fallback.reset(items());
    changes.clear();
    for (const job of pending.values()) job.resolve(fallback.query(job.query));
    pending.clear();
  }

  function start() {
    if (started) return;
    started = true;
    try {
      worker = new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' });
      worker.addEventListener('message', (event: MessageEvent<SearchResult>) => {
        const job = pending.get(event.data.request);
        if (!job) return;
        pending.delete(event.data.request);
        job.resolve(event.data.ids);
      });
      worker.addEventListener('error', useFallback);
      send({ type: 'reset', items: items() });
    } catch { useFallback(); }
  }

  return {
    reset(next: SearchItem[]) {
      changes.clear();
      content.clear();
      for (const item of next) if (item.content !== null) content.set(item.id, item.content);
      if (worker) send({ type: 'reset', items: next });
      fallback?.reset(next);
    },
    update(next: SearchItem[]) {
      const changed = next.filter(item => item.content === null
        ? content.has(item.id) : content.get(item.id) !== item.content);
      for (const item of changed) {
        if (item.content === null) content.delete(item.id);
        else content.set(item.id, item.content);
      }
      // Coalesce body snapshots until a search actually needs them. Saving with
      // no active query should not clone note bodies into a worker on every edit.
      if (worker) for (const item of changed) changes.set(item.id, item.content);
      fallback?.update(changed);
    },
    query(query: string): Promise<string[]> {
      start();
      if (fallback) return Promise.resolve(fallback.query(query));
      const id = ++request;
      return new Promise(resolve => {
        pending.set(id, { query, resolve });
        try {
          if (changes.size) {
            send({ type: 'update', items: [...changes].map(([id, content]) => ({ id, content })) });
            changes.clear();
          }
          send({ type: 'query', query, request: id });
        }
        catch { useFallback(); }
      });
    },
    destroy() {
      worker?.terminate();
      for (const job of pending.values()) job.resolve([]);
      pending.clear();
      content.clear();
      changes.clear();
    },
  };
}
