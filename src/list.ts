import { titleFromContent, type Note } from './types';
import { formatCreatedAt } from './dates';
import { createSearch } from './search';

const CARD_H = 190;
const GAP = 10;
const COLS_MIN_WIDTH = 340;

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
  let windowKey = '';
  const search = createSearch();
  const cards = new Map<string, { element: HTMLElement; content: string | null; createdAt: number }>();

  function cols(): number {
    return Math.max(2, Math.floor(scrollEl.clientWidth / COLS_MIN_WIDTH) + 1);
  }

  function layout() {
    const rows = Math.ceil(filtered.length / cols());
    const holder = rows * (CARD_H + GAP) + GAP;
    const maxScroll = Math.max(0, holder - scrollEl.clientHeight);
    if (scrollEl.scrollTop > maxScroll) scrollEl.scrollTop = maxScroll;
    spacerEl.style.height = holder + 'px';
    render();
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
        filtered = items;
        scheduleRender();
        return;
      }
      void search.query(query).then(ids => {
        if (version !== filterVersion) return;
        matched = new Set(ids);
        filtered = items.filter(note => matched!.has(note.id));
        scheduleRender();
      });
    });
  }

  function scheduleRender() {
    if (destroyed) return;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      layout();
    });
  }

  function cardFor(n: Note): HTMLElement {
    let cached = cards.get(n.id);
    if (!cached) {
      const card = document.createElement('div');
      card.className = 'note-card';
      card.dataset.noteId = n.id;
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      const preview = document.createElement('div');
      preview.className = 'card-preview';
      card.appendChild(preview);
      const created = document.createElement('time');
      created.className = 'card-created';
      card.appendChild(created);
      cached = { element: card, content: null, createdAt: NaN };
      cards.set(n.id, cached);
    }
    const card = cached.element;
    card.classList.toggle('active', n.id === activeId);
    card.setAttribute('aria-pressed', String(n.id === activeId));
    if (cached.content !== n.content) {
      card.setAttribute('aria-label', titleFromContent(n.content));
      // A six-line paragraph can still be enormous. Cap DOM text as well as lines.
      const text = n.content.slice(0, 1200);
      const lines = text.split('\n');
      card.firstElementChild!.textContent = lines.slice(0, 6).join('\n')
        + (lines.length > 6 || n.content.length > text.length ? ' …' : '');
      cached.content = n.content;
    }
    if (cached.createdAt !== n.createdAt) {
      const created = card.lastElementChild as HTMLTimeElement;
      created.textContent = formatCreatedAt(n.createdAt);
      const date = new Date(n.createdAt);
      created.dateTime = Number.isFinite(date.getTime()) ? date.toISOString() : '';
      cached.createdAt = n.createdAt;
    }
    return card;
  }

  function render() {
    const c = cols();
    const startRow = Math.max(0, Math.floor(scrollEl.scrollTop / (CARD_H + GAP)) - 1);
    const rowCount = Math.ceil(scrollEl.clientHeight / (CARD_H + GAP)) + 2;
    const endRow = Math.min(Math.ceil(filtered.length / c), startRow + rowCount);
    const visible = filtered.slice(startRow * c, endRow * c);
    const key = `${c}:${startRow}:${visible.map(note => note.id).join(',')}`;
    if (key === windowKey) {
      for (const note of visible) cardFor(note);
      return;
    }
    windowKey = key;
    const focused = document.activeElement instanceof HTMLElement
      ? document.activeElement.closest<HTMLElement>('[data-note-id]')?.dataset.noteId : null;
    rowsEl.style.transform = `translateY(${startRow * (CARD_H + GAP) + GAP}px)`;
    const frag = document.createDocumentFragment();
    for (let r = startRow; r < endRow; r++) {
      const rowDiv = document.createElement('div');
      rowDiv.className = 'grid-row';
      rowDiv.style.height = CARD_H + 'px';
      for (let k = 0; k < c; k++) {
        const i = r * c + k;
        if (i >= filtered.length) break;
        const n = filtered[i];
        rowDiv.appendChild(cardFor(n));
      }
      frag.appendChild(rowDiv);
    }
    rowsEl.replaceChildren(frag);
    const visibleIds = new Set(visible.map(note => note.id));
    for (const id of cards.keys()) if (!visibleIds.has(id)) cards.delete(id);
    if (focused && visibleIds.has(focused)) cards.get(focused)?.element.focus({ preventScroll: true });
  }

  function open(event: MouseEvent | KeyboardEvent) {
    const card = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-note-id]') : null;
    if (!card?.dataset.noteId) return;
    if (event instanceof KeyboardEvent) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
    }
    onOpen(card.dataset.noteId);
  }
  rowsEl.addEventListener('click', open);
  rowsEl.addEventListener('keydown', open);
  scrollEl.addEventListener('scroll', scheduleRender);

  const observer = new ResizeObserver(scheduleRender);
  observer.observe(scrollEl);

  return {
    setItems(next) {
      items = [...next];
      search.reset(items.map(note => ({ id: note.id, content: note.content })));
      scheduleFilter();
    },
    upsertItems(changed) {
      for (const note of changed) {
        const index = items.findIndex(item => item.id === note.id);
        if (index >= 0) items.splice(index, 1);
        if (note.deleted) continue;
        let low = 0, high = items.length;
        while (low < high) {
          const mid = (low + high) >>> 1;
          if (items[mid].updatedAt > note.updatedAt) low = mid + 1;
          else high = mid;
        }
        items.splice(low, 0, note);
      }
      search.update(changed.map(note => ({ id: note.id, content: note.deleted ? null : note.content })));
      if (query) {
        // Retain the last result while a worker checks changed text. Never allow
        // a deleted note or an old query response to reappear in the meantime.
        filtered = items.filter(note => matched?.has(note.id));
      } else filtered = items;
      scheduleFilter();
      scheduleRender();
    },
    refreshRow(id) {
      const idx = items.findIndex((n) => n.id === id);
      if (idx > 0) {
        const [n] = items.splice(idx, 1);
        items.unshift(n);
      }
      filtered = matched ? items.filter(note => matched!.has(note.id)) : items;
      scheduleRender();
    },
    setActive(id) {
      activeId = id;
      for (const [cardId, cached] of cards) {
        cached.element.classList.toggle('active', cardId === id);
        cached.element.setAttribute('aria-pressed', String(cardId === id));
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
      scrollEl.removeEventListener('scroll', scheduleRender);
      rowsEl.removeEventListener('click', open);
      rowsEl.removeEventListener('keydown', open);
      search.destroy();
    },
  };
}
