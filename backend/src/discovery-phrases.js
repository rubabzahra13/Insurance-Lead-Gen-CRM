// Sanitize AI discovery phrases before they enter Google Boolean lanes.
// Phrases are market hints for THIS search only — never a hardcoded prestige list.

const FORBIDDEN = /[()\"{}[\]|:]/;

/**
 * Keep short, safe LinkedIn-style phrases from AI. Drop operators / junk.
 * @param {unknown} raw
 * @param {{ max?: number }} [opts]
 * @returns {string[]}
 */
export function sanitizeDiscoveryPhrases(raw, { max = 6 } = {}) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();

  for (const item of raw) {
    let text = String(item ?? '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/^["'`]+|["'`]+$/g, '');
    if (text.length < 2 || text.length > 48) continue;
    if (FORBIDDEN.test(text)) continue;
    if (/^(and|or|not|site:)/i.test(text)) continue;
    // Reject boolean-looking blobs.
    if (/\bOR\b|\bAND\b/.test(text)) continue;

    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= max) break;
  }

  return out;
}

/** Build an OR-group for SerpAPI, or empty string when nothing usable. */
export function buildDiscoveryClause(phrases = []) {
  const clean = sanitizeDiscoveryPhrases(phrases);
  if (!clean.length) return '';
  const parts = clean.map((p) => (p.includes(' ') ? `"${p}"` : p));
  return `(${parts.join(' OR ')})`;
}
