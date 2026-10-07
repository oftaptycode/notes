import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createList } from '../src/list';
import { note } from './helpers';
import type { SearchMessage } from '../src/searchIndex';

let frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
class TestWorker extends EventTarget {
  static last: TestWorker;
  messages: SearchMessage[] = [];
  constructor() { super(); TestWorker.last = this; }
  postMessage(message: SearchMessage) { this.messages.push(message); }
  terminate() {}
  answer(request: number, ids: string[]) {
    this.dispatchEvent(new MessageEvent('message', { data: { request, ids } }));
  }
}
beforeEach(() => {
  frames = new Map();
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('Worker', undefined);
});
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  for (const [id, callback] of frames) { frames.delete(id); callback(0); }
}
function fixture() {
  const scroll = document.createElement('div');
  const spacer = document.createElement('div');
  const rows = document.createElement('div');
  Object.defineProperties(scroll, { clientWidth: { value: 320 }, clientHeight: { value: 600 } });
  scroll.append(spacer, rows);
  document.body.append(scroll);
  const onOpen = vi.fn();
  const list = createList(scroll, spacer, rows, onOpen);
  return { scroll, rows, list, onOpen };
}

it('updates only changed cards, retains focus, bounds preview text and skips same-window scroll rebuilds', async () => {
  const { scroll, rows, list, onOpen } = fixture();
  try {
    list.setItems([note('a', 'first'), note('b', 'second')]);
    await flush();
    const a = rows.querySelector<HTMLElement>('[data-note-id="a"]')!;
    const b = rows.querySelector<HTMLElement>('[data-note-id="b"]')!;
    a.focus();
    scroll.scrollTop = 10;
    scroll.dispatchEvent(new Event('scroll'));
    await flush();
    expect(rows.querySelector('[data-note-id="a"]')).toBe(a);
    list.upsertItems([note('b', 'x'.repeat(10000), { updatedAt: 3000 })]);
    await flush();
    expect(rows.querySelector('[data-note-id="b"]')).toBe(b);
    expect(b.querySelector('.card-preview')!.textContent!.length).toBeLessThan(1300);
    expect(document.activeElement).toBe(a);
    expect(rows.firstElementChild!.firstElementChild).toBe(b);
    b.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onOpen).toHaveBeenCalledWith('b');
    list.upsertItems([note('b', '', { deleted: true })]);
    await flush();
    expect(rows.querySelector('[data-note-id="b"]')).toBeNull();
  } finally { list.destroy(); }
});

it('searches current full note text after edits, insertion and deletion', async () => {
  const { rows, list } = fixture();
  try {
    list.setItems([note('a', 'One\nMixed BODY'), note('b', 'Other')]);
    list.setQuery('MIXED body');
    vi.advanceTimersByTime(80);
    await flush();
    expect([...rows.querySelectorAll<HTMLElement>('[data-note-id]')].map(card => card.dataset.noteId)).toEqual(['a']);
    list.upsertItems([note('a', 'no match'), note('c', 'mixed BODY', { updatedAt: 3000 })]);
    await flush();
    expect([...rows.querySelectorAll<HTMLElement>('[data-note-id]')].map(card => card.dataset.noteId)).toEqual(['c']);
    list.upsertItems([note('c', '', { deleted: true })]);
    await flush();
    expect(rows.querySelectorAll('[data-note-id]')).toHaveLength(0);
    list.setQuery('');
    await flush();
    expect(rows.querySelectorAll('[data-note-id]')).toHaveLength(2);
  } finally { list.destroy(); }
});

it('ignores late worker results for superseded queries or edited data', async () => {
  vi.stubGlobal('Worker', TestWorker);
  const { rows, list } = fixture();
  try {
    list.setItems([note('a', 'alpha'), note('b', 'beta')]);
    await flush();
    list.setQuery('alpha');
    vi.advanceTimersByTime(80);
    await flush();
    const worker = TestWorker.last;
    const alpha = worker.messages.find(message => message.type === 'query')!;
    list.setQuery('beta');
    vi.advanceTimersByTime(80);
    await flush();
    const beta = worker.messages.at(-1)!;
    if (beta.type === 'query') worker.answer(beta.request, ['b']);
    await flush();
    if (alpha.type === 'query') worker.answer(alpha.request, ['a']);
    await flush();
    expect(rows.querySelector('[data-note-id="b"]')).not.toBeNull();
    expect(rows.querySelector('[data-note-id="a"]')).toBeNull();
    list.upsertItems([note('b', 'no match')]);
    await flush();
    const updated = worker.messages.at(-1)!;
    list.setQuery('');
    if (updated.type === 'query') worker.answer(updated.request, []);
    await flush();
    expect(rows.querySelectorAll('[data-note-id]')).toHaveLength(2);
  } finally { list.destroy(); }
});
