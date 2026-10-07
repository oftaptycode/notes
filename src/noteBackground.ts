import type { Mood, MoodProbability } from '../supabase/functions/_shared/moods';

const EMOTION_COLORS: Record<Exclude<Mood, 'Neutral'>, string> = {
  Admiration: '#c77dff',
  Amusement: '#ffa726',
  Approval: '#7cc576',
  Caring: '#ffb3c6',
  Desire: '#a3185f',
  Excitement: '#ff6a00',
  Gratitude: '#f4c95d',
  Joy: '#ffeb3b',
  Love: '#ff4f81',
  Optimism: '#ffd166',
  Pride: '#b5179e',
  Relief: '#8fe3ef',
  Anger: '#d90429',
  Annoyance: '#c8581a',
  Disappointment: '#5c677d',
  Disapproval: '#7f4f24',
  Disgust: '#6b8e23',
  Embarrassment: '#ff9a8b',
  Fear: '#3a2a7a',
  Grief: '#242a4a',
  Nervousness: '#a99be0',
  Remorse: '#4a4e69',
  Sadness: '#2a6fdb',
  Confusion: '#9b5de5',
  Curiosity: '#00a896',
  Realization: '#4cc9f0',
  Surprise: '#2ee6a8',
};
const GRAYS = ['#929aa5', '#5e6875', '#c2c7d0'];

export type NoteBackground = ReturnType<typeof createNoteBackground>;

export function createNoteBackground(pane: HTMLElement) {
  let currentPalette = '';
  function setMood(mood: Mood | null, probabilities?: readonly MoodProbability[]) {
    let colors = GRAYS;
    if (mood && mood !== 'Neutral') {
      const primary = EMOTION_COLORS[mood];
      // Blend the dominant emotion with meaningful runners-up, not tiny tails
      // of the distribution. Gray adds depth when only one emotion is strong.
      const secondary = (probabilities ?? [])
        .filter(entry => entry.value !== 'Neutral' && entry.value !== mood && entry.probability >= 0.08)
        .sort((a, b) => b.probability - a.probability)
        .slice(0, 2)
        .map(entry => EMOTION_COLORS[entry.value as Exclude<Mood, 'Neutral'>]);
      colors = [primary, secondary[0] ?? primary, secondary[1] ?? GRAYS[0]];
    }
    const palette = colors.join(',');
    if (palette === currentPalette) return;
    currentPalette = palette;
    colors.forEach((color, index) => pane.style.setProperty(`--lava-${index + 1}`, color));
    // Updating colors never recreates the layers or restarts their animation.
  }
  setMood(null);
  return { setMood };
}
