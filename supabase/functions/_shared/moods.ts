export const MOOD_MODEL = 'gpt-6-luna';
export const MOOD_VERSION = 'v4';
export const LEGACY_MOOD_VERSION = 'v3';
export const MIN_MOOD_CONTENT_LENGTH = 100;
export const MAX_MOOD_CONTENT_LENGTH = 50_000;

// Count Unicode characters, excluding leading/trailing whitespace. Stop at the
// threshold so eligibility checks remain cheap while editing long notes.
export function hasEnoughMoodContent(content: string): boolean {
  let length = 0;
  for (const _character of content.trim()) {
    if (++length >= MIN_MOOD_CONTENT_LENGTH) return true;
  }
  return false;
}

export const MOOD_CHOICES = [
  { value: 'Admiration', description: 'Finding someone or something impressive or worthy of respect.' },
  { value: 'Amusement', description: 'Finding something funny or entertaining.' },
  { value: 'Anger', description: 'Strong displeasure, hostility or indignation.' },
  { value: 'Annoyance', description: 'Mild irritation or exasperation.' },
  { value: 'Approval', description: 'Agreement or a favorable opinion.' },
  { value: 'Caring', description: 'Kindness, compassion or concern for another’s well-being.' },
  { value: 'Confusion', description: 'Uncertainty, lack of understanding or being puzzled.' },
  { value: 'Curiosity', description: 'Interest in learning, knowing or exploring something.' },
  { value: 'Desire', description: 'Wanting, wishing for or craving something.' },
  { value: 'Disappointment', description: 'Sadness or displeasure from unmet expectations.' },
  { value: 'Disapproval', description: 'Disagreement or an unfavorable opinion.' },
  { value: 'Disgust', description: 'Revulsion or strong aversion.' },
  { value: 'Embarrassment', description: 'Self-consciousness, awkwardness or shame.' },
  { value: 'Excitement', description: 'Enthusiasm or eager anticipation.' },
  { value: 'Fear', description: 'Feeling threatened, frightened or afraid of danger.' },
  { value: 'Gratitude', description: 'Thankfulness or appreciation.' },
  { value: 'Grief', description: 'Intense sorrow over a loss, especially bereavement.' },
  { value: 'Joy', description: 'Happiness, pleasure or delight.' },
  { value: 'Love', description: 'Affection, attachment or deep fondness.' },
  { value: 'Nervousness', description: 'Anxious unease, worry or apprehension.' },
  { value: 'Optimism', description: 'Hope or confidence about a favorable future outcome.' },
  { value: 'Pride', description: 'Satisfaction in one’s achievements or those of someone close.' },
  { value: 'Realization', description: 'A new insight or suddenly understanding something.' },
  { value: 'Relief', description: 'Reassurance or release after worry, difficulty or pressure.' },
  { value: 'Remorse', description: 'Regret or guilt about a past action.' },
  { value: 'Sadness', description: 'Unhappiness, sorrow or low spirits.' },
  { value: 'Surprise', description: 'A reaction to something unexpected.' },
  { value: 'Neutral', description: 'Practical, factual, emotionally neutral or insufficient emotional evidence.' },
] as const;

export type Mood = typeof MOOD_CHOICES[number]['value'];
export interface MoodProbability { value: Mood; probability: number }

export function isMood(value: unknown): value is Mood {
  return typeof value === 'string' && MOOD_CHOICES.some(choice => choice.value === value);
}

// Preserve the actual choice distribution, including zero-probability options.
// Reject missing/duplicate options instead of inventing probabilities for them.
export function parseMoodProbabilities(value: unknown): MoodProbability[] | null {
  if (!Array.isArray(value) || value.length !== MOOD_CHOICES.length) return null;
  const seen = new Set<Mood>();
  const probabilities: MoodProbability[] = [];
  for (const entry of value) {
    if (!entry || !isMood(entry.value) || seen.has(entry.value)
      || typeof entry.probability !== 'number' || !Number.isFinite(entry.probability)
      || entry.probability < 0 || entry.probability > 1) return null;
    seen.add(entry.value);
    probabilities.push({ value: entry.value, probability: entry.probability });
  }
  if (Math.abs(probabilities.reduce((sum, entry) => sum + entry.probability, 0) - 1) > 0.02) return null;
  return probabilities.sort((a, b) => b.probability - a.probability || a.value.localeCompare(b.value));
}
