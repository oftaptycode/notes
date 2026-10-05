import { titleFromContent, type Note } from './types';

const ROW = 64;

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

  function applyFilter() {
    const q = query.trim().toLowerCase();
    filtered = q === '' ? items : items.filter((n) => n.content.toLowerCase().includes(q));
    const maxScroll = Math.max(0, filtered.length * ROW - scrollEl.clientHeight);
    if (scrollEl.scrollTop > maxScroll) scrollEl.scrollTop = maxScroll;
    spacerEl.style.height = filtered.length * ROW + 'px';
    render();
  }

  function render() {
    const startIdx = Math.max(0, Math.floor(scrollEl.scrollTop / ROW) - 2);
    const count = Math.ceil(scrollEl.clientHeight / ROW) + 4;
    const endIdx = Math.min(filtered.length, startIdx + count);
    rowsEl.style.transform = `translateY(${startIdx * ROW}px)`;
    const frag = document.createDocumentFragment();
    for (let i = startIdx; i < endIdx; i++) {
      const n = filtered[i];
      const div = document.createElement('div');
      div.className = 'row' + (n.id === activeId ? ' active' : '');
      div.style.height = ROW + 'px';
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = titleFromContent(n.content);
      const date = document.createElement('div');
      date.className = 'date';
      date.textContent = new Date(n.updatedAt).toLocaleString();
      div.appendChild(title);
      div.appendChild(date);
      div.addEventListener('click', () => onOpen(n.id));
      frag.appendChild(div);
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

  return {
    setItems(next) {
      items = next;
      applyFilter();
    },
    refreshRow(id) {
      // Re-rank: move note to top if it was edited
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
