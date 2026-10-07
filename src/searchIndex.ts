export interface SearchItem { id: string; content: string | null }

// Lives in the search worker in browsers. Normalization happens once per changed
// note, never again for each character typed into the query.
export class SearchIndex {
  private text = new Map<string, string>();

  reset(items: SearchItem[]) {
    this.text.clear();
    this.update(items);
  }

  update(items: SearchItem[]) {
    for (const item of items) {
      if (item.content === null) this.text.delete(item.id);
      else this.text.set(item.id, item.content.toLowerCase());
    }
  }

  query(query: string): string[] {
    const normalized = query.trim().toLowerCase();
    const ids: string[] = [];
    for (const [id, text] of this.text) if (text.includes(normalized)) ids.push(id);
    return ids;
  }
}

export type SearchMessage =
  | { type: 'reset' | 'update'; items: SearchItem[] }
  | { type: 'query'; query: string; request: number };
export interface SearchResult { request: number; ids: string[] }
