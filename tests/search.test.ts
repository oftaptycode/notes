import { afterEach, expect, it, vi } from 'vitest';
import { SearchIndex, type SearchMessage } from '../src/searchIndex';
import { createSearch } from '../src/search';

class TestWorker extends EventTarget {
  static last: TestWorker;
  messages: SearchMessage[] = [];
  terminate = vi.fn();
  constructor() { super(); TestWorker.last = this; }
  postMessage(message: SearchMessage) { this.messages.push(message); }
  answer(request: number, ids: string[]) {
    this.dispatchEvent(new MessageEvent('message', { data: { request, ids } }));
  }
}
afterEach(() => vi.unstubAllGlobals());

it('normalizes once per change and preserves case-insensitive full-content substring search', () => {
  const index = new SearchIndex();
  index.reset([{ id: 'a', content: 'First\nMiXeD body café 😀' }, { id: 'b', content: 'Second' }]);
  expect(index.query('  MIXED BODY  ')).toEqual(['a']);
  expect(index.query('café 😀')).toEqual(['a']);
  expect(index.query('missing')).toEqual([]);
  index.update([{ id: 'a', content: 'Now changed' }, { id: 'b', content: null }]);
  expect(index.query('mixed')).toEqual([]);
  expect(index.query('changed')).toEqual(['a']);
  index.reset([{ id: 'c', content: 'Replacement' }]);
  expect(index.query('')).toEqual(['c']);
});

it('starts the worker lazily, coalesces changed snapshots, and pairs out-of-order replies', async () => {
  vi.stubGlobal('Worker', TestWorker);
  const search = createSearch();
  search.reset([{ id: 'a', content: 'old' }]);
  const first = search.query('first');
  const worker = TestWorker.last;
  const second = search.query('second');
  const queries = worker.messages.filter(message => message.type === 'query');
  worker.answer(queries[1].request, ['b']);
  worker.answer(queries[0].request, ['a']);
  expect(await first).toEqual(['a']);
  expect(await second).toEqual(['b']);
  search.update([{ id: 'a', content: 'intermediate' }]);
  search.update([{ id: 'a', content: 'latest' }]);
  expect(worker.messages.filter(message => message.type === 'update')).toHaveLength(0);
  const third = search.query('latest');
  expect(worker.messages.at(-2)).toEqual({ type: 'update', items: [{ id: 'a', content: 'latest' }] });
  const query = worker.messages.at(-1)!;
  if (query.type === 'query') worker.answer(query.request, ['a']);
  expect(await third).toEqual(['a']);
  search.destroy();
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it('falls back to a cached index when worker loading fails, without hanging pending queries', async () => {
  vi.stubGlobal('Worker', TestWorker);
  const search = createSearch();
  search.reset([{ id: 'a', content: 'hello' }]);
  const result = search.query('HELLO');
  TestWorker.last.dispatchEvent(new Event('error'));
  expect(await result).toEqual(['a']);
  search.update([{ id: 'a', content: null }, { id: 'b', content: 'world' }]);
  expect(await search.query('world')).toEqual(['b']);
  search.destroy();
});
