import { expect, it } from 'vitest';
import { hasEnoughMoodContent, isBlankContent, MIN_MOOD_CONTENT_LENGTH } from '../supabase/functions/_shared/moods';
import { titleFromContent } from '../src/types';

// These helpers replaced `content.trim()` on the per-keystroke path. They must
// agree with `trim()` exactly, or notes would be deleted or titled incorrectly.

it('treats only whitespace-only text as blank, matching trim()', () => {
  const cases = ['', ' ', '\n', '\t', '\r\n', ' \t\n ', '\u00a0', '\u2000', '\u3000',
    '\ufeff', '\u2028', '\u2029', '\u200b', '\v', '\f'];
  for (const value of cases) {
    expect(isBlankContent(value)).toBe(value.trim() === '');
  }
  for (const value of ['a', ' a ', '\n.\n', '0', '\u200bx', 'a\u00a0']) {
    expect(isBlankContent(value)).toBe(value.trim() === '');
    expect(isBlankContent(value)).toBe(false);
  }
});

it('agrees with the trim-based threshold check', () => {
  const bodies = ['', ' \n ', 'x', 'x'.repeat(MIN_MOOD_CONTENT_LENGTH - 1),
    'x'.repeat(MIN_MOOD_CONTENT_LENGTH), 'x'.repeat(MIN_MOOD_CONTENT_LENGTH + 5),
    '  ' + 'y'.repeat(MIN_MOOD_CONTENT_LENGTH) + '  ',
    '\n\n' + 'z'.repeat(50) + '\n\n'];
  for (const body of bodies) {
    const expected = (() => {
      let length = 0;
      for (const _character of body.trim()) if (++length >= MIN_MOOD_CONTENT_LENGTH) return true;
      return false;
    })();
    expect(hasEnoughMoodContent(body)).toBe(expected);
  }
});

it('counts astral characters once, as the previous code-point loop did', () => {
  // Each emoji is one code point but two UTF-16 units.
  const body = '\u{1F600}'.repeat(MIN_MOOD_CONTENT_LENGTH);
  expect(body.length).toBe(MIN_MOOD_CONTENT_LENGTH * 2);
  expect(hasEnoughMoodContent(body)).toBe(true);
  expect(hasEnoughMoodContent('\u{1F600}'.repeat(MIN_MOOD_CONTENT_LENGTH - 1))).toBe(false);
});

it('returns the first nonempty line without scanning a huge single-line note', () => {
  expect(titleFromContent('')).toBe('Untitled');
  expect(titleFromContent('\n\n   \n# Heading\nbody')).toBe('Heading');
  // Preserved quirk: the list-marker strip runs first, so the task-marker regex
  // never matches and "- [ ] task" titles as "[ ] task". Unchanged by the
  // bounded-window rewrite; changing it is a product decision, not a perf fix.
  expect(titleFromContent('- [ ] task\nnext')).toBe('[ ] task');
  expect(titleFromContent('* bullet\nnext')).toBe('bullet');
  expect(titleFromContent('x'.repeat(200))).toBe('x'.repeat(80) + '…');
  // A title is read from a bounded window, so a very long first line still works.
  const long = '# ' + 'a'.repeat(50_000);
  expect(titleFromContent(long)).toBe('a'.repeat(80) + '…');
  // A '#' with no following space is not a heading, so it is kept verbatim.
  expect(titleFromContent('#'.padEnd(200, 'a'))).toBe('#' + 'a'.repeat(79) + '…');
  // Leading blank lines are skipped even when there are many.
  expect(titleFromContent('\n'.repeat(500) + 'deep')).toBe('deep');
});
