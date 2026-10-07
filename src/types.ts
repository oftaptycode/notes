export interface Note {
  id: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
  dirty: boolean;
  // Last server state acknowledged by this device. Optional for existing notes.
  synced?: {
    content: string;
    deleted: boolean;
    serverUpdatedAt: string;
  };
}

export function conflictCopy(content: string): Note {
  const now = Date.now();
  return {
    id: newId(),
    content: '(conflict copy)\n\n' + content,
    createdAt: now,
    updatedAt: now,
    deleted: false,
    dirty: true,
  };
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function titleFromContent(content: string): string {
  let from = 0;
  while (from < content.length) {
    const newline = content.indexOf('\n', from);
    const to = newline < 0 ? content.length : newline;
    const line = content.slice(from, to).trim();
    from = to + 1;
    if (line.length === 0) continue;
    const stripped = line.replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+/, '').replace(/^[-*]\s*\[.\]\s+/, '');
    return stripped.length > 80 ? stripped.slice(0, 80) + '…' : stripped;
  }
  return 'Untitled';
}
