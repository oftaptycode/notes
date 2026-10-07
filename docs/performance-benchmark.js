// Synthetic microbenchmarks, not production instrumentation or a CI test.
// Run against a Vite dev server on a separate localhost origin:
// const { runPerformanceAudit } = await import('/docs/performance-benchmark.js');
// await runPerformanceAudit('editor'); await runPerformanceAudit('storage');
// Never reads or writes the application's notes databases.

async function dependency(source, name) {
  // Preserve Vite's query string: importing an unversioned URL can create a
  // second CodeMirror module instance with incompatible state-field identity.
  const text = await (await fetch(source)).text();
  const urls = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map(match => match[1]);
  const url = urls.find(url => url.includes(name));
  if (!url) throw new Error(`Could not resolve ${name} from ${source}`);
  // An absolute URL also prevents Vite's dynamic-import helper adding ?import,
  // which would give this module a different browser identity.
  return import(/* @vite-ignore */ new URL(url, location.origin).href);
}

const block = [
  '# Heading', '',
  'Paragraph **bold** *italic* [link](https://example.com) «text».', '',
  '> quoted', '', '- item', '', '',
].join('\n');

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    medianMs: sorted[Math.floor(sorted.length / 2)],
    maxMs: sorted[sorted.length - 1],
    samples: sorted.length,
  };
}

async function editorBenchmark() {
  const { EditorState } = await dependency('/src/editor.ts', '@codemirror_state');
  const { markdown } = await dependency('/src/editor.ts', '@codemirror_lang-markdown');
  const { GFM } = await dependency('/src/editor.ts', '@lezer_markdown');
  const { ensureSyntaxTree, syntaxTree } = await dependency('/src/markdown.ts', '@codemirror_language');
  const { markdownDecorations } = await import('/src/markdown.ts');
  const { Guillemets } = await import('/src/guillemets.ts');
  const results = [];
  for (const blocks of [100, 1000, 5000]) {
    const doc = block.repeat(blocks);
    for (const formatting of [false, true]) {
      let state = EditorState.create({
        doc,
        extensions: [markdown({ extensions: [GFM, Guillemets] }),
          ...(formatting ? [markdownDecorations] : [])],
      });
      // Model an already-open, fully parsed document; initial CodeMirror parsing
      // is deliberately partial. This is not a cold-open or end-to-end latency.
      if (!ensureSyntaxTree(state, doc.length, 10000)) throw new Error('Incomplete parse');
      state = state.update({}).state;
      const samples = [];
      for (let i = 0; i < 20; i++) {
        const start = performance.now();
        state = state.update({ changes: { from: 15, insert: 'x' } }).state;
        samples.push(performance.now() - start);
      }
      results.push({ chars: doc.length, formatting,
        treeLength: syntaxTree(state).length, ...summarize(samples) });
    }
  }
  return results;
}

async function storageBenchmark() {
  const { openDB, deleteDB } = await dependency('/src/db.ts', '/idb');
  const { createList } = await import('/src/list.ts');
  const { createSearch } = await import('/src/search.ts');
  const search = createSearch();
  const name = `notes-performance-audit-${crypto.randomUUID()}`;
  const db = await openDB(name, 1, {
    upgrade(db) {
      const store = db.createObjectStore('notes', { keyPath: 'id' });
      store.createIndex('updatedAt', 'updatedAt');
    },
  });
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-2000px;width:320px;height:600px;overflow:auto';
  const spacer = document.createElement('div');
  const rows = document.createElement('div');
  host.append(spacer, rows);
  document.body.append(host);
  const list = createList(host, spacer, rows, () => {});
  const results = [];
  try {
    // Reproduce db.getAllNotes' actual getAll/filter/sort algorithm in a new,
    // isolated database, including full-content sync baselines.
    for (const count of [100, 1000, 5000]) {
      await db.clear('notes');
      const tx = db.transaction('notes', 'readwrite');
      for (let i = 0; i < count; i++) {
        const content = `${i}: ` + 'ordinary note text\n'.repeat(556);
        await tx.store.put({
          id: String(i), content, createdAt: i, updatedAt: i,
          deleted: false, dirty: false,
          synced: { content, deleted: false, serverUpdatedAt: '2026-10-07T00:00:00Z' },
        });
      }
      await tx.done;
      const scans = [], updates = [], searches = [], searchDispatch = [];
      let items = (await db.getAll('notes')).sort((a, b) => b.updatedAt - a.updatedAt);
      list.setItems(items);
      search.reset(items.map(note => ({ id: note.id, content: note.content })));
      // Dispatch timings intentionally exclude deferred DOM/paint work. This
      // benchmark also works in hidden tabs, where animation frames are paused.
      await Promise.resolve();
      for (let i = 0; i < 5; i++) {
        let start = performance.now();
        const all = await db.getAll('notes');
        items = all.filter(note => !note.deleted).sort((a, b) => b.updatedAt - a.updatedAt);
        scans.push(performance.now() - start);
        start = performance.now();
        list.upsertItems([{ ...items[0], content: items[0].content + i, updatedAt: count + i }]);
        updates.push(performance.now() - start);
        await Promise.resolve();
        start = performance.now();
        const result = search.query('not present');
        searchDispatch.push(performance.now() - start);
        await result;
        searches.push(performance.now() - start);
      }
      results.push({ count, charsPerNote: items[0].content.length,
        rawCollectionScan: summarize(scans), listUpdateDispatch: summarize(updates),
        searchDispatch: summarize(searchDispatch), searchResultElapsed: summarize(searches) });
    }
  } finally {
    list.destroy();
    search.destroy();
    host.remove();
    db.close();
    await deleteDB(name);
  }
  return results;
}

export async function runPerformanceAudit(section = 'editor') {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) {
    throw new Error('Use a separate localhost Vite dev-server origin');
  }
  const results = section === 'editor' ? await editorBenchmark()
    : section === 'storage' ? await storageBenchmark()
    : (() => { throw new Error('Choose editor or storage'); })();
  console.table(results);
  return { section, userAgent: navigator.userAgent,
    viewport: { width: innerWidth, height: innerHeight }, results };
}
