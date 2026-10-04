export interface Note {
  id: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
  dirty: boolean;
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
  const lines = content.split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    const stripped = line.replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+/, '').replace(/^[-*]\s*\[.\]\s+/, '');
    return stripped.length > 80 ? stripped.slice(0, 80) + '…' : stripped;
  }
  return 'Untitled';
}
