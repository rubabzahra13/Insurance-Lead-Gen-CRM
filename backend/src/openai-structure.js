// OpenAI structuring for the experimental SERP engine. Used when the Anthropic
// account is unavailable (e.g. no credits). Returns a response shaped like the
// Claude/Gemini structurers so parseStructuredLeads consumes it unchanged.

import { structureLeadsPrompt } from './prompts.js';

const OPENAI_API = 'https://api.openai.com/v1/chat/completions';

function apiKey() {
  return (process.env.OPENAI_API_KEY ?? process.env.OPENAI_KEY)?.trim();
}

export function openaiAvailable() {
  return Boolean(apiKey());
}

export async function structureWithOpenAI(
  rawItems,
  searchPrompt,
  { maxResults = 15, structureContext = null } = {},
) {
  const key = apiKey();
  if (!key) throw new Error('OPENAI_API_KEY not set');

  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  const prompt = structureLeadsPrompt(rawItems, searchPrompt, maxResults, structureContext);
  const maxRetries = Number(process.env.OPENAI_MAX_RETRIES ?? 3);

  const body = JSON.stringify({
    model,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          'You extract structured lead data from search results as strict JSON. ' +
          'Copy only facts present in the results — never invent. Output only the JSON the user asks for.',
      },
      { role: 'user', content: prompt },
    ],
  });

  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(OPENAI_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body,
        signal: AbortSignal.timeout(Number(process.env.OPENAI_TIMEOUT_MS ?? 60_000)),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        // 429/5xx are worth retrying; other statuses are not.
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries - 1) {
          lastError = new Error(`OpenAI error ${res.status}`);
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
          continue;
        }
        throw new Error(`OpenAI error ${res.status}: ${errBody.slice(0, 180)}`);
      }

      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content ?? '';
      // parseStructuredLeads reads .text (parseJsonFromText tolerates surrounding prose).
      return { text, groundingChunks: [], provider: 'openai' };
    } catch (error) {
      // Retry transient network failures ("fetch failed", timeouts).
      lastError = error;
      if (attempt < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        continue;
      }
    }
  }
  throw lastError ?? new Error('OpenAI request failed');
}
