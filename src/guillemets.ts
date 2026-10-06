import type { MarkdownConfig } from '@lezer/markdown';

// Inline custom delimiter: «text» is guillemet-quoted text.
const GuillemetDelim = { resolve: 'Guillemet', mark: 'GuillemetMark' };

export const Guillemets: MarkdownConfig = {
  defineNodes: [{ name: 'Guillemet' }, { name: 'GuillemetMark' }],
  parseInline: [
    {
      name: 'Guillemets',
      parse(cx, next, pos) {
        if (next === 171 /* '«' */) {
          return cx.addDelimiter(GuillemetDelim, pos, pos + 1, true, false);
        }
        if (next === 187 /* '»' */) {
          return cx.addDelimiter(GuillemetDelim, pos, pos + 1, false, true);
        }
        return -1;
      },
      after: 'Emphasis',
    },
  ],
};
