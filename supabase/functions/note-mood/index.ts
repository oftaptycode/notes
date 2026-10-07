import {
  isMood, parseMoodProbabilities, hasEnoughMoodContent, MIN_MOOD_CONTENT_LENGTH,
  MAX_MOOD_CONTENT_LENGTH, MOOD_CHOICES, MOOD_MODEL, MOOD_VERSION,
} from '../_shared/moods.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const responseHeaders = { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...responseHeaders, ...headers } });

// A small per-instance safety limit, in addition to the single-user allowlist.
let windowStart = 0;
let requests = 0;

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const authorization = request.headers.get('Authorization') ?? '';
  if (!/^Bearer\s+\S+$/i.test(authorization)) return json({ error: 'Sign in to detect mood.' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  const ownerId = Deno.env.get('MOOD_USER_ID');
  if (!supabaseUrl || !anonKey || !apiKey || !ownerId) {
    return json({ error: 'Mood detection is not configured on the server.' }, 503);
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) abort();
  const timeout = setTimeout(abort, 20_000);
  try {
    // Validate the access token with Supabase Auth, rather than trusting decoded
    // claims or relying on the gateway's legacy JWT verifier.
    const authResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: authorization, apikey: anonKey },
      signal: controller.signal,
    });
    if (!authResponse.ok) return json({ error: 'Sign in to detect mood.' }, 401);
    const user = await authResponse.json();
    if (user.id !== ownerId) return json({ error: 'Mood detection is only available to the app owner.' }, 403);

    const contentLength = Number(request.headers.get('Content-Length') ?? 0);
    if (contentLength > 310_000) return json({ error: 'This note is too long to analyze.' }, 413);
    let body: { content?: unknown };
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }
    if (!body || typeof body.content !== 'string') return json({ error: 'A note is required.' }, 400);
    if (body.content.length > MAX_MOOD_CONTENT_LENGTH) return json({ error: 'This note is too long to analyze.' }, 413);
    if (!body.content.trim()) return json({ error: 'The note is empty.' }, 400);
    if (!hasEnoughMoodContent(body.content)) {
      return json({ error: `Notes need at least ${MIN_MOOD_CONTENT_LENGTH} characters for mood detection.` }, 422);
    }

    const now = Date.now();
    if (now - windowStart >= 60_000) { windowStart = now; requests = 0; }
    if (requests >= 60) return json({ error: 'Mood detection is temporarily busy.' }, 429, { 'Retry-After': '60' });
    requests++;

    const instructions = 'Judge the emotional atmosphere of this Markdown note. '
      + 'Account for sarcasm, fiction and quoted material; do not mistake a quoted speaker for the author. '
      + 'Ignore programming code and Markdown syntax as emotional evidence.';
    const decision = await fetch('https://api.openai.com/v1/decisions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: MOOD_MODEL,
        input: body.content,
        questions: [
          {
            type: 'predicate', name: 'emotional_tone',
            instructions: `${instructions} Does the note express a meaningful emotional tone rather than just factual or practical information?`,
          },
          {
            type: 'choice', name: 'mood',
            instructions: `${instructions} Choose the dominant emotion`,
            choices: MOOD_CHOICES,
          },
        ],
      }),
    });
    if (!decision.ok) {
      if (decision.status === 429) return json({ error: 'Mood detection is temporarily busy.' }, 429, { 'Retry-After': '60' });
      if (decision.status === 401 || decision.status === 403) return json({ error: 'Check the server’s OpenAI API key and Decisions access.' }, 503);
      return json({ error: 'The mood service is temporarily unavailable.' }, 502);
    }
    const result = await decision.json();
    const answers = Array.isArray(result.answers) ? result.answers : [];
    const tone = answers.find((answer: { name?: string }) => answer.name === 'emotional_tone');
    const mood = answers.find((answer: { name?: string }) => answer.name === 'mood');
    if (tone?.type === 'refusal' || mood?.type === 'refusal') {
      return json({ error: 'The model could not classify this note.' }, 422);
    }
    if (tone?.type !== 'predicate' || !Number.isFinite(tone.probability)
      || tone.probability < 0 || tone.probability > 1 || mood?.type !== 'choice' || !isMood(mood.choice)) {
      return json({ error: 'The mood service returned an invalid result.' }, 502);
    }
    const probabilities = parseMoodProbabilities(mood.probabilities);
    if (!probabilities) return json({ error: 'The mood service returned an incomplete probability distribution.' }, 502);
    return json({
      mood: tone.probability < 0.55 ? 'Neutral' : mood.choice,
      probabilities,
      model: MOOD_MODEL,
      version: MOOD_VERSION,
    });
  } catch {
    // Never log note text, bearer tokens, provider responses or API keys.
    return json({ error: 'The mood service did not respond. Try again shortly.' }, 504);
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener('abort', abort);
  }
});
