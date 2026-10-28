import { titleFromContent, type Note } from './types';
import { formatDate } from './dates';
import { createSearch } from './search';

export interface ListHandle {
  setItems(items: Note[]): void;
  upsertItems(items: Note[]): void;
  refreshRow(id: string): void;
  setActive(id: string | null): void;
  setQuery(q: string): void;
  getActiveId(): string | null;
  destroy(): void;
}

export function createList(
  scrollEl: HTMLElement,
  spacerEl: HTMLElement,
  rowsEl: HTMLElement,
  onOpen: (id: string) => void,
): ListHandle {
  let items: Note[] = [];
  let filtered: Note[] = [];
  let query = '';
  let activeId: string | null = null;
  let raf = 0;
  let filterVersion = 0;
  let filterQueued = false;
  let queryTimer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;
  let matched: Set<string> | null = null;
  const search = createSearch();
  const elements = new Map<string, HTMLElement>();

  function sortByDate(arr: Note[]): Note[] {
    return [...arr].sort((a, b) => b.createdAt - a.createdAt);
  }

  function itemFor(n: Note): HTMLElement {
    let el = elements.get(n.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'note-list-item';
      el.dataset.noteId = n.id;
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      const title = document.createElement('div');
      title.className = 'note-list-title';
      el.appendChild(title);
      const created = document.createElement('time');
      created.className = 'note-list-date';
      el.appendChild(created);
      elements.set(n.id, el);
    }
    el.classList.toggle('active', n.id === activeId);
    el.setAttribute('aria-pressed', String(n.id === activeId));
    const fullTitle = titleFromContent(n.content);
    const titleText = fullTitle.length > 20 ? fullTitle.slice(0, 20) + '…' : fullTitle;
    const titleEl = el.firstElementChild as HTMLElement;
    if (titleEl.textContent !== titleText) titleEl.textContent = titleText;
    el.setAttribute('aria-label', titleText);
    const createdEl = el.lastElementChild as HTMLTimeElement;
    const formatted = formatDate(n.createdAt);
    if (createdEl.textContent !== formatted) createdEl.textContent = formatted;
    const date = new Date(n.createdAt);
    createdEl.dateTime = Number.isFinite(date.getTime()) ? date.toISOString() : '';
    return el;
  }

  function render() {
    if (destroyed) return;
    const frag = document.createDocumentFragment();
    for (const n of filtered) frag.appendChild(itemFor(n));
    rowsEl.replaceChildren(frag);
    // Drop cached elements for notes that no longer exist.
    for (const id of [...elements.keys()]) {
      if (!items.some((note) => note.id === id)) elements.delete(id);
    }
  }

  function scheduleRender() {
    if (destroyed) return;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      render();
    });
  }

  function scheduleFilter() {
    clearTimeout(queryTimer);
    filterVersion++;
    if (filterQueued) return;
    filterQueued = true;
    queueMicrotask(() => {
      filterQueued = false;
      if (destroyed) return;
      const version = filterVersion;
      if (!query) {
        matched = null;
        filtered = sortByDate(items);
        render();
        return;
      }
      void search.query(query).then((ids) => {
        if (version !== filterVersion) return;
        matched = new Set(ids);
        filtered = sortByDate(items.filter((note) => matched!.has(note.id)));
        render();
      });
    });
  }

  function open(event: MouseEvent | KeyboardEvent) {
    const item = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-note-id]') : null;
    if (!item?.dataset.noteId) return;
    if (event instanceof KeyboardEvent) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
    }
    onOpen(item.dataset.noteId);
  }
  rowsEl.addEventListener('click', open);
  rowsEl.addEventListener('keydown', open);

  const observer = new ResizeObserver(() => render());
  observer.observe(scrollEl);

  return {
    setItems(next) {
      items = sortByDate(next);
      search.reset(items.map((note) => ({ id: note.id, content: note.content })));
      scheduleFilter();
    },
    upsertItems(changed) {
      for (const note of changed) {
        const index = items.findIndex((item) => item.id === note.id);
        if (index >= 0) items.splice(index, 1);
        if (note.deleted) continue;
        items.push(note);
      }
      items = sortByDate(items);
      search.update(changed.map((note) => ({ id: note.id, content: note.deleted ? null : note.content })));
      if (query) {
        filtered = matched ? sortByDate(items.filter((note) => matched!.has(note.id))) : sortByDate(items);
      } else {
        filtered = sortByDate(items);
      }
      scheduleFilter();
      render();
    },
    refreshRow(id) {
      items = sortByDate(items);
      filtered = matched ? sortByDate(items.filter((note) => matched!.has(note.id))) : sortByDate(items);
      render();
    },
    setActive(id) {
      activeId = id;
      for (const [itemId, el] of elements) {
        el.classList.toggle('active', itemId === id);
        el.setAttribute('aria-pressed', String(itemId === id));
      }
    },
    setQuery(q) {
      const next = q.trim().toLowerCase();
      if (query === next) return;
      query = next;
      filterVersion++;
      clearTimeout(queryTimer);
      if (!query) scheduleFilter();
      else queryTimer = setTimeout(scheduleFilter, 80);
    },
    getActiveId: () => activeId,
    destroy() {
      destroyed = true;
      filterVersion++;
      clearTimeout(queryTimer);
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      rowsEl.removeEventListener('click', open);
      rowsEl.removeEventListener('keydown', open);
      search.destroy();
    },
  };
}