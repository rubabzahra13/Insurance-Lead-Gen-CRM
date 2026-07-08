// Normalize Gemini and Claude API responses into one shape for extraction/grounding.

export function normalizeLlmResponse(response) {
  if (response?.groundingChunks && response?.text !== undefined) {
    return response;
  }
  if (Array.isArray(response?.content)) {
    return normalizeClaudeResponse(response);
  }
  return normalizeGeminiResponse(response);
}

function normalizeGeminiResponse(response) {
  const candidate = response?.candidates?.[0];
  const text = candidate?.content?.parts?.map((part) => part.text ?? '').join('\n') ?? '';
  const groundingChunks = (candidate?.groundingMetadata?.groundingChunks ?? []).map((chunk) => ({
    title: chunk.web?.title ?? '',
    uri: chunk.web?.uri ?? '',
    citedText: chunk.web?.snippet ?? '',
    directUrl: false,
  }));

  return { text, groundingChunks, raw: response, provider: 'gemini' };
}

function pickDescription(...values) {
  const cleaned = values.map((v) => v?.trim()).filter(Boolean);
  if (cleaned.length === 0) return '';
  return cleaned.sort((a, b) => b.length - a.length)[0];
}

function normalizeClaudeResponse(response) {
  const textParts = [];
  const chunkByUrl = new Map();

  const upsertChunk = (title, uri, citedText = '') => {
    const key = (uri ?? '').trim();
    if (!key) return;

    const description = citedText?.trim() ?? '';
    const existing = chunkByUrl.get(key);

    if (existing) {
      existing.citedText = pickDescription(existing.citedText, description);
      if (title && (!existing.title || existing.title.length < title.length)) {
        existing.title = title;
      }
      return;
    }

    chunkByUrl.set(key, {
      title: title ?? '',
      uri: key,
      citedText: description,
      directUrl: true,
    });
  };

  for (const block of response?.content ?? []) {
    if (block.type === 'text' && block.text) {
      textParts.push(block.text);
      for (const cite of block.citations ?? []) {
        upsertChunk(
          cite.title,
          cite.url,
          cite.cited_text ?? cite.citedText ?? cite.snippet ?? '',
        );
      }
    }

    if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const result of block.content) {
        if (result.type === 'web_search_result') {
          upsertChunk(
            result.title,
            result.url,
            result.cited_text ??
              result.snippet ??
              result.description ??
              result.page_snippet ??
              '',
          );
        }
      }
    }
  }

  return {
    text: textParts.join('\n'),
    groundingChunks: [...chunkByUrl.values()],
    raw: response,
    provider: 'claude',
  };
}

export function getResponseText(response) {
  return normalizeLlmResponse(response).text;
}
