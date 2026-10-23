import { updateNotes } from './db';
import { conflictCopy, type Note } from './types';
import { isBlankContent } from '../supabase/functions/_shared/moods';

export interface Edit {
  id: string;
  content: string;
  previousContent: string;
}

// Preserve a server/other-tab update that arrived after the editor loaded.
export async function saveEdit(edit: Edit): Promise<Note[]> {
  // Scans in place: `trim()` would copy the entire note on every keystroke.
  const deleted = isBlankContent(edit.content);
  return updateNotes(edit.id, (current) => {
    if (!current) throw new Error('The note is no longer available. Keep the editor open and copy its text.');
    if (current.deleted === deleted && current.content === edit.content) return [current];
    const backup = current.content !== edit.previousContent || (current.deleted && !current.dirty)
      ? [conflictCopy(current.content)]
      : [];
    return [{
      ...current,
      content: edit.content,
      deleted,
      dirty: true,
      updatedAt: Math.max(Date.now(), current.updatedAt + 1),
    }, ...backup];
  });
}
