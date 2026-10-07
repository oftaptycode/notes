import { SearchIndex, type SearchMessage, type SearchResult } from './searchIndex';

const index = new SearchIndex();
self.addEventListener('message', (event: MessageEvent<SearchMessage>) => {
  const message = event.data;
  if (message.type === 'query') {
    const result: SearchResult = { request: message.request, ids: index.query(message.query) };
    self.postMessage(result);
  } else if (message.type === 'reset') index.reset(message.items);
  else index.update(message.items);
});
