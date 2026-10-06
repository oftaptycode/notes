import { beforeEach, expect, it, vi } from 'vitest';
import { note, resetDatabase } from './helpers';

beforeEach(() => {
  vi.resetModules();
  resetDatabase();
});

it('keeps untouched notes clean and deletes whitespace-only edits', async () => {
  const db = await import('../src/db');
  const { saveEdit } = await import('../src/save');
  const original = note('n');
  await db.putNote(original);
  await saveEdit({ id: 'n', content: original.content, previousContent: original.content });
  expect(await db.getNote('n')).toEqual(original);
  await saveEdit({ id: 'n', content: ' \n\t', previousContent: original.content });
  expect(await db.getNote('n')).toMatchObject({ deleted: true, dirty: true });
  expect(await db.getAllNotes()).toEqual([]);
});

it('backs up an intervening update before saving a stale editor', async () => {
  const db = await import('../src/db');
  const { saveEdit } = await import('../src/save');
  await db.putNote(note('n', 'remote edit'));
  await saveEdit({ id: 'n', content: 'my edit', previousContent: 'original' });
  expect(await db.getNote('n')).toMatchObject({ content: 'my edit', dirty: true });
  expect((await db.getAllNotes()).map(n => n.content)).toContain('(conflict copy)\n\nremote edit');
});

it('serializes simultaneous read/compare/write transactions', async () => {
  const db = await import('../src/db');
  await db.putNote(note('n', '0'));
  await Promise.all(Array.from({ length: 5 }, () => db.updateNotes('n', current => [
    { ...current!, content: String(Number(current!.content) + 1) },
  ])));
  expect((await db.getNote('n'))?.content).toBe('5');
});
