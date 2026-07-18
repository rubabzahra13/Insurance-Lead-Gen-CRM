// Location helpers for Avatar 1/2 search:
// 1) Pull a place from the user's query ("… in Pakistan", "Dallas insurance grads")
// 2) Bias Google via SerpAPI location/gl
// 3) Drop leads whose profile text clearly doesn't match that place

// Country / region aliases used both for extraction and matching.
const PLACE_ALIASES = {
  pakistan: {
    gl: 'pk',
    serpLocation: 'Pakistan',
    tokens: [
      'pakistan', 'pakistani', 'lahore', 'karachi', 'islamabad', 'rawalpindi',
      'faisalabad', 'multan', 'peshawar', 'quetta', 'sialkot', 'hyderabad',
      'gujranwala', 'punjab', 'sindh', 'balochistan', 'khyber',
    ],
  },
  india: {
    gl: 'in',
    serpLocation: 'India',
    tokens: [
      'india', 'indian', 'mumbai', 'delhi', 'bangalore', 'bengaluru', 'hyderabad',
      'chennai', 'kolkata', 'pune', 'ahmedabad', 'jaipur', 'gurgaon', 'gurugram',
      'noida', 'maharashtra', 'karnataka',
    ],
  },
  'united arab emirates': {
    gl: 'ae',
    serpLocation: 'United Arab Emirates',
    tokens: ['uae', 'dubai', 'abu dhabi', 'sharjah', 'emirates', 'united arab emirates'],
  },
  'united kingdom': {
    gl: 'uk',
    serpLocation: 'United Kingdom',
    tokens: [
      'uk', 'united kingdom', 'england', 'scotland', 'wales', 'london', 'manchester',
      'birmingham', 'edinburgh', 'glasgow', 'leeds', 'bristol',
    ],
  },
  canada: {
    gl: 'ca',
    serpLocation: 'Canada',
    tokens: [
      'canada', 'canadian', 'toronto', 'vancouver', 'montreal', 'calgary', 'ottawa',
      'edmonton', 'ontario', 'british columbia', 'alberta', 'quebec',
    ],
  },
  australia: {
    gl: 'au',
    serpLocation: 'Australia',
    tokens: [
      'australia', 'australian', 'sydney', 'melbourne', 'brisbane', 'perth',
      'adelaide', 'nsw', 'victoria',
    ],
  },
  'united states': {
    gl: 'us',
    serpLocation: 'United States',
    tokens: [
      'united states', 'usa', 'u.s.', 'u.s.a', 'america', 'american',
    ],
  },
};

// Common US cities / states so "in Dallas" / "Texas" extract correctly.
const US_LOCAL = {
  dallas: ['dallas', 'tx', 'texas'],
  houston: ['houston', 'tx', 'texas'],
  austin: ['austin', 'tx', 'texas'],
  chicago: ['chicago', 'il', 'illinois'],
  'new york': ['new york', 'nyc', 'ny', 'manhattan', 'brooklyn'],
  'los angeles': ['los angeles', 'la', 'california', 'ca'],
  'san francisco': ['san francisco', 'sf', 'bay area', 'california', 'ca'],
  miami: ['miami', 'fl', 'florida'],
  atlanta: ['atlanta', 'ga', 'georgia'],
  seattle: ['seattle', 'wa', 'washington'],
  boston: ['boston', 'ma', 'massachusetts'],
  denver: ['denver', 'co', 'colorado'],
  phoenix: ['phoenix', 'az', 'arizona'],
  philadelphia: ['philadelphia', 'pa', 'pennsylvania'],
  florida: ['florida', 'fl', 'miami', 'orlando', 'tampa'],
  texas: ['texas', 'tx', 'dallas', 'houston', 'austin', 'san antonio'],
  california: ['california', 'ca', 'los angeles', 'san francisco', 'san diego'],
};

const ROLE_WORDS = new Set([
  'the', 'and', 'or', 'for', 'with', 'major', 'majors', 'agent', 'agents',
  'producer', 'producers', 'insurance', 'finance', 'sales', 'graduate', 'graduates',
  'student', 'students', 'intern', 'interns', 'entry', 'level', 'seeking', 'looking',
  'broker', 'brokers', 'advisor', 'advisors', 'manager', 'managers',
]);

export function normalizePlaceKey(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[.’']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildHint({ label, gl, serpLocation, tokens, mustInclude = [], scope = null }) {
  const unique = [...new Set(tokens.map(normalizePlaceKey).filter(Boolean))];
  const required = [...new Set((mustInclude || []).map(normalizePlaceKey).filter(Boolean))];
  return {
    label,
    gl: gl || null,
    serpLocation: serpLocation || label,
    tokens: unique,
    mustInclude: required,
    scope: scope || (required.length ? 'city' : 'country'),
  };
}

function isRolePhrase(phrase) {
  const words = normalizePlaceKey(phrase).split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => ROLE_WORDS.has(w));
}

function matchKnownPlace(phrase) {
  const key = normalizePlaceKey(phrase);
  if (!key || key.length < 2 || isRolePhrase(phrase)) return null;

  for (const [name, meta] of Object.entries(PLACE_ALIASES)) {
    // Exact country match → accept any region/city token for that country.
    if (key === name) {
      return buildHint({
        label: meta.serpLocation,
        gl: meta.gl,
        serpLocation: meta.serpLocation,
        tokens: [name, ...meta.tokens],
        mustInclude: [],
      });
    }
    // City/region inside a country → keep scope tight (Karachi ≠ Baltistan).
    if (meta.tokens.includes(key)) {
      const label = key.replace(/\b\w/g, (c) => c.toUpperCase());
      const demonym = name === 'pakistan' ? ['pakistani'] : name === 'india' ? ['indian'] : [];
      return buildHint({
        label,
        gl: meta.gl,
        serpLocation: `${label}, ${meta.serpLocation}`,
        tokens: [key, name, ...demonym],
        mustInclude: [key],
      });
    }
  }

  for (const [name, tokens] of Object.entries(US_LOCAL)) {
    if (key === name || tokens.includes(key)) {
      const label = name.replace(/\b\w/g, (c) => c.toUpperCase());
      // City/state searches must mention that place (not just "US").
      const must = key === name ? [name] : [key];
      return buildHint({
        label,
        gl: 'us',
        serpLocation: `${label}, United States`,
        tokens: [name, ...tokens, 'united states', 'usa', 'us'],
        mustInclude: must,
      });
    }
  }

  // No generic "any single word is a place" fallback here: ROLE_WORDS cannot list
  // every job title, so bare roles ("nurse", "accountant") became strict city
  // filters and the search returned nothing. Callers that do have explicit
  // locational context ("in <place>") build their own hint; unknown places are
  // resolved by Google Places upstream.
  return null;
}

/**
 * Extract a location hint from a free-text search query.
 * Prefers "in/near/around/from <place>" patterns, then known country/city names.
 */
export function extractQueryLocation(query) {
  const text = String(query ?? '').trim();
  if (!text) return null;

  const inPlace = text.match(
    /\b(?:in|near|around|from|based in)\s+([A-Za-z][A-Za-z\s.'-]{1,40}?)(?:\s*[,.]?\s*$|\s+(?:who|with|looking|seeking|for)\b)/i,
  );
  if (inPlace) {
    const phrase = inPlace[1].trim();
    const hint = matchKnownPlace(phrase);
    if (hint) return hint;
    const key = normalizePlaceKey(phrase);
    if (key.length >= 2 && !ROLE_WORDS.has(key) && !isRolePhrase(phrase)) {
      const label = phrase.replace(/\b\w/g, (c) => c.toUpperCase());
      return buildHint({
        label,
        gl: null,
        serpLocation: label,
        tokens: [key],
        mustInclude: [key],
      });
    }
  }

  const lower = normalizePlaceKey(text);

  // Country mention first — accept any city in that country (mustInclude stays empty).
  for (const [name, meta] of Object.entries(PLACE_ALIASES)) {
    if (new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower)) {
      return buildHint({
        label: meta.serpLocation,
        gl: meta.gl,
        serpLocation: meta.serpLocation,
        tokens: [name, ...meta.tokens],
        mustInclude: [],
        scope: 'country',
      });
    }
  }

  // US states / cities (before generic city token scan).
  for (const [name, tokens] of Object.entries(US_LOCAL)) {
    if (lower.includes(name) || tokens.some((t) => t.length >= 3 && new RegExp(`\\b${t}\\b`).test(lower))) {
      const isState = ['texas', 'california', 'florida'].includes(name);
      return matchKnownPlace(name) || buildHint({
        label: name.replace(/\b\w/g, (c) => c.toUpperCase()),
        gl: 'us',
        serpLocation: `${name.replace(/\b\w/g, (c) => c.toUpperCase())}, United States`,
        tokens: [name, ...tokens, 'united states', 'usa', 'us'],
        mustInclude: isState ? [] : [name],
        scope: isState ? 'country' : 'city',
      });
    }
  }

  // City / region tokens embedded in query (e.g. "producers karachi" or "lahore finance").
  let bestCity = null;
  for (const [name, meta] of Object.entries(PLACE_ALIASES)) {
    for (const token of meta.tokens) {
      if (token === name) continue;
      if (token.length >= 4 && lower.includes(token)) {
        const hint = matchKnownPlace(token);
        if (hint && (!bestCity || token.length > bestCity.label.length)) bestCity = hint;
      }
    }
  }
  if (bestCity) return bestCity;

  // Trailing known place only: "Karachi producers" (not bare role words).
  const trailing = text.match(/\b([A-Za-z][A-Za-z\s.'-]{2,30})\s*$/);
  if (trailing) {
    const phrase = trailing[1].trim();
    const key = normalizePlaceKey(phrase);
    if (!ROLE_WORDS.has(key) && !isRolePhrase(phrase)) {
      const hint = matchKnownPlace(phrase);
      if (hint && (hint.scope === 'country' || hint.mustInclude.length > 0 || PLACE_ALIASES[key])) {
        return hint;
      }
    }
  }

  return null;
}

/** True when the user's query explicitly names a place (never inferred by AI alone). */
export function querySpecifiesLocation(query) {
  return extractQueryLocation(query) !== null;
}

/** Rewrite the user query so the place is quoted for stronger Google matching. */
export function emphasizeLocationInQuery(query, locationHint) {
  const text = String(query ?? '').trim();
  if (!text || !locationHint?.label) return text;

  const label = locationHint.label;
  const quoted = `"${label}"`;
  // If already quoted, leave as-is.
  if (text.includes(quoted)) return text;

  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}\\b`, 'i');
  if (re.test(text)) {
    return text.replace(re, quoted);
  }
  return `${text} ${quoted}`;
}

function leadCorpus(lead) {
  return [
    lead.location,
    lead.title,
    lead.company,
    lead.snippet,
    lead.evidence,
    lead.fit_evidence,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * True when the lead's own text supports the requested place.
 * Explicit conflicting countries (e.g. US when query is Pakistan) fail even
 * if a token accidentally overlaps.
 */
export function leadMatchesLocation(lead, locationHint) {
  if (!locationHint?.tokens?.length) return true;

  const corpus = leadCorpus(lead);
  if (!corpus.trim()) return false;

  // City-scoped searches (e.g. Karachi) require that city token, not just "Pakistan".
  for (const token of locationHint.mustInclude || []) {
    if (!token) continue;
    const ok = token.length <= 3
      ? new RegExp(`(?:^|[^a-z])${token}(?:[^a-z]|$)`, 'i').test(corpus)
      : corpus.includes(token);
    if (!ok) return false;
  }

  const hit = locationHint.tokens.some((token) => {
    if (!token || token.length < 2) return false;
    // Prefer word-boundary match for short tokens (us, uk, tx).
    if (token.length <= 3) {
      return new RegExp(`(?:^|[^a-z])${token}(?:[^a-z]|$)`, 'i').test(corpus);
    }
    return corpus.includes(token);
  });

  if (!hit) return false;

  // If the requested place is non-US and the lead clearly says US, reject.
  const wantsUs = locationHint.gl === 'us' || locationHint.tokens.includes('united states');
  if (!wantsUs) {
    const usSignals = [
      /\bunited states\b/i, /\busa\b/i, /\bu\.s\.a?\b/i,
      /\b\w+,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV)\b/,
      /\b(tucson|dallas|houston|austin|chicago|miami|seattle|boston|denver|phoenix|atlanta)\b/i,
    ];
    const loc = String(lead.location ?? '');
    if (usSignals.some((re) => re.test(loc) || re.test(corpus))) {
      // Allow if the corpus also strongly names the target country (dual citizens / "Pakistan / US").
      const strong = locationHint.tokens
        .filter((t) => t.length >= 5)
        .some((t) => corpus.includes(t));
      if (!strong) return false;
    }
  }

  return true;
}

/**
 * Keep only leads that match the query location. When no location was asked for,
 * returns leads unchanged.
 */
export function filterLeadsByQueryLocation(leads, query, { onDrop } = {}) {
  const hint = extractQueryLocation(query);
  if (!hint) return { leads, locationHint: null, dropped: [] };

  const kept = [];
  const dropped = [];
  for (const lead of leads) {
    if (leadMatchesLocation(lead, hint)) kept.push(lead);
    else {
      dropped.push(lead);
      onDrop?.(lead, hint);
    }
  }
  return { leads: kept, locationHint: hint, dropped };
}

/**
 * When a lead passed the location filter but has no location field, fill it from
 * the strongest place token found in their own text, else the query place label.
 */
export function fillMissingLocations(leads, locationHint) {
  const queryLabel = String(locationHint?.label || '').trim();
  if (!locationHint?.tokens?.length && !queryLabel) return leads;

  return leads.map((lead) => {
    if (lead.location?.trim()) return lead;
    const corpus = leadCorpus(lead);
    const found = [...(locationHint.tokens || [])]
      .filter((token) => token.length >= 4 && corpus.includes(token))
      .sort((a, b) => b.length - a.length);
    if (found.length) {
      const label = found[0].replace(/\b\w/g, (c) => c.toUpperCase());
      return { ...lead, location: label };
    }
    if (queryLabel) {
      return { ...lead, location: queryLabel };
    }
    return lead;
  });
}

// Light guardrail: reject locations that look copied from the search query, not the results.
export function vetLocationEcho(location, searchPrompt, rawItems, evidence = '') {
  if (!location?.trim()) return null;

  const trimmed = location.trim();
  const city = trimmed.split(',')[0].trim().toLowerCase();
  if (!city || city.length < 3) return trimmed;

  const queryLower = (searchPrompt ?? '').toLowerCase();
  if (!queryLower.includes(city)) return trimmed;

  const corpus = rawItems
    .map((item) => `${item.title ?? ''} ${item.snippet ?? ''}`)
    .join(' ')
    .toLowerCase();
  const support = `${corpus} ${evidence ?? ''}`.toLowerCase();

  // Accept if city or any significant token from the location appears in results
  if (support.includes(city)) return trimmed;
  const tokens = city.split(/\s+/).filter((t) => t.length >= 4);
  if (tokens.some((token) => support.includes(token))) return trimmed;

  return null;
}
