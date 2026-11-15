import { formatTimedTranscript } from './clipSelector.js';

function parseStoryResponse(raw, duration) {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace < 0 || lastBrace <= firstBrace) {
      throw new Error('ChatGPT story selection returned invalid JSON', { cause: error });
    }
    try {
      parsed = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    } catch (parseError) {
      throw new Error('ChatGPT story selection returned invalid JSON', { cause: parseError });
    }
  }

  if (!Array.isArray(parsed?.stories)) {
    throw new Error('ChatGPT story selection response did not contain a stories array');
  }

  const stories = parsed.stories.flatMap(story => {
    if (!story || typeof story !== 'object' || story.start == null || story.end == null) return [];
    const start = Number(story.start);
    const end = Number(story.end);
    const title = String(story.title || '').trim();
    const summary = String(story.summary || '').trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > duration || !title || !summary) {
      return [];
    }
    return [{
      start,
      end,
      title,
      summary,
      excerpt: String(story.excerpt || '').trim(),
      reason: String(story.reason || '').trim(),
      score: Math.min(10, Math.max(1, Number(story.score) || 1)),
    }];
  }).slice(0, 30);

  if (stories.length < 25) {
    throw new Error(`ChatGPT returned ${stories.length} valid story moments; at least 25 are required`);
  }
  return stories;
}

export async function selectStories(transcript, duration, segments = []) {
  const key = process.env.LLM_API_KEY;
  if (!key) throw new Error('LLM_API_KEY is not configured in the server .env file');
  if (!transcript?.trim()) throw new Error('No transcript text is available for story selection');
  if (!Number.isFinite(Number(duration)) || Number(duration) <= 0) {
    throw new Error('A valid source duration is required for story selection');
  }

  const timedTranscript = formatTimedTranscript(segments);
  const sourceText = (timedTranscript || transcript).slice(0, 100000);
  const prompt = `You are an expert short-form story editor. From this timestamped podcast transcript, select the 25 to 30 strongest distinct, self-contained story moments. Prioritize personal experiences, surprising events, emotional turns, memorable examples, and stories with a clear beginning and payoff. Do not select generic discussion or invent dialogue, facts, or timestamps. Spread the selections across the source and avoid overlapping or repetitive moments. Every start/end must match the transcript's source-time ranges, use seconds, satisfy start < end, and stay within ${duration} seconds. Keep each moment long enough to preserve its context (usually 20 to 120 seconds when available). For each, provide a concise card title, a one- or two-sentence summary, an exact short transcript excerpt, why it is compelling, and an integer score from 1 to 10. Return only JSON in this shape: {"stories":[{"start":number,"end":number,"title":string,"summary":string,"excerpt":string,"reason":string,"score":number}]}. Transcript:\n${sourceText}`;
  const url = `${(process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '')}/chat/completions`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({
        model: process.env.LLM_MODEL || 'gpt-4o-mini',
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch (error) {
    throw new Error(`ChatGPT story request failed before receiving a response: ${error.message}`, { cause: error });
  }
  const data = await response.json();
  if (!response.ok) {
    throw new Error(`ChatGPT story selection error (${response.status}): ${data.error?.message || 'Request failed'}`);
  }
  const raw = data.choices?.[0]?.message?.content || '';
  if (!raw) throw new Error('ChatGPT did not return story selection content');
  return { stories: parseStoryResponse(raw, Number(duration)) };
}
