import type { Note } from './types';

const CARD_H = 190;
const GAP = 10;
const COLS_MIN_WIDTH = 340;

export interface ListHandle {
  setItems(items: Note[]): void;
  refreshRow(id: string): void;
  setActive(id: string | null): void;
  setQuery(q: string): void;
  getActiveId(): string | null;
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

  function cols(): number {
    return Math.max(2, Math.floor(scrollEl.clientWidth / COLS_MIN_WIDTH) + 1);
  }

  function applyFilter() {
    const q = query.trim().toLowerCase();
    filtered = q === '' ? items : items.filter((n) => n.content.toLowerCase().includes(q));
    const rows = Math.ceil(filtered.length / cols());
    const holder = rows * (CARD_H + GAP) + GAP;
    const maxScroll = Math.max(0, holder - scrollEl.clientHeight);
    if (scrollEl.scrollTop > maxScroll) scrollEl.scrollTop = maxScroll;
    spacerEl.style.height = holder + 'px';
    render();
  }

  function render() {
    const c = cols();
    const startRow = Math.max(0, Math.floor(scrollEl.scrollTop / (CARD_H + GAP)) - 1);
    const rowCount = Math.ceil(scrollEl.clientHeight / (CARD_H + GAP)) + 2;
    const endRow = Math.min(Math.ceil(filtered.length / c), startRow + rowCount);
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
        const card = document.createElement('div');
        card.className = 'note-card' + (n.id === activeId ? ' active' : '');
        const preview = document.createElement('div');
        preview.className = 'card-preview';
        preview.textContent = n.content;
        const meta = document.createElement('div');
        meta.className = 'card-meta';
        meta.textContent = new Date(n.updatedAt).toLocaleDateString(undefined, {
          month: 'long', day: 'numeric', year: 'numeric',
        });
        card.appendChild(preview);
        card.appendChild(meta);
        card.addEventListener('click', () => onOpen(n.id));
        rowDiv.appendChild(card);
      }
      frag.appendChild(rowDiv);
    }
    rowsEl.replaceChildren(frag);
  }

  scrollEl.addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      render();
    });
  });

  new ResizeObserver(() => applyFilter()).observe(scrollEl);

  return {
    setItems(next) {
      items = next;
      applyFilter();
    },
    refreshRow(id) {
      const idx = items.findIndex((n) => n.id === id);
      if (idx > 0) {
        const [n] = items.splice(idx, 1);
        items.unshift(n);
      }
      applyFilter();
    },
    setActive(id) {
      activeId = id;
      render();
    },
    setQuery(q) {
      query = q;
      applyFilter();
    },
    getActiveId: () => activeId,
  };
}
