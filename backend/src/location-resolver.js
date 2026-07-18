// Location resolution: extract → Google Places (primary) → AI (fallback).
// Soft phrase extract (typos OK) — not a hard "known place" gate.

import { extractQueryLocation, normalizePlaceKey } from './location.js';
import { openaiAvailable } from './openai-structure.js';
import { parseJsonFromText } from './parse-json.js';

const GOOGLE_PLACES_TEXT_SEARCH = 'https://places.googleapis.com/v1/places:searchText';
const OPENAI_API = 'https://api.openai.com/v1/chat/completions';

const ROLE_WORDS = new Set([
  'the', 'and', 'or', 'for', 'with', 'major', 'majors', 'agent', 'agents',
  'producer', 'producers', 'insurance', 'finance', 'sales', 'graduate', 'graduates',
  'student', 'students', 'intern', 'interns', 'entry', 'level', 'seeking', 'looking',
  'broker', 'brokers', 'advisor', 'advisors', 'manager', 'managers', 'claims',
  'adjuster', 'adjusters', 'underwriter', 'underwriters', 'people', 'leads',
]);

const COUNTRY_GL = {
  pakistan: 'pk',
  india: 'in',
  'united states': 'us',
  usa: 'us',
  'united kingdom': 'uk',
  uk: 'uk',
  canada: 'ca',
  australia: 'au',
  'united arab emirates': 'ae',
  uae: 'ae',
  germany: 'de',
  france: 'fr',
  spain: 'es',
  italy: 'it',
  netherlands: 'nl',
  brazil: 'br',
  mexico: 'mx',
  japan: 'jp',
  china: 'cn',
  'south africa': 'za',
  nigeria: 'ng',
  bangladesh: 'bd',
  indonesia: 'id',
  philippines: 'ph',
  singapore: 'sg',
  malaysia: 'my',
  'saudi arabia': 'sa',
  turkey: 'tr',
  egypt: 'eg',
};

/** USPS → full state name. SerpAPI rejects many "City, ST, USA" strings (0 hits). */
const US_STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
  TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
};

/**
 * Normalize a location string for SerpAPI's `location` param.
 * Places often returns "Chicago, IL, USA" which SerpAPI silently matches to nothing.
 */
export function toSerpApiLocation(value) {
  let s = String(value || '').trim();
  if (!s) return null;

  s = s
    .replace(/,\s*U\.S\.A\.?\s*$/i, ', United States')
    .replace(/,\s*USA\s*$/i, ', United States')
    .replace(/,\s*US\s*$/i, ', United States');

  const abbr = s.match(/^(.+?),\s*([A-Za-z]{2}),\s*United States$/i);
  if (abbr) {
    const state = US_STATE_NAMES[abbr[2].toUpperCase()];
    if (state) return `${abbr[1].trim()}, ${state}, United States`;
  }
  return s;
}

const KNOWN_COUNTRIES = new Set(Object.keys(COUNTRY_GL));

function normList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((v) => normalizePlaceKey(String(v ?? ''))).filter(Boolean))];
}

function placesApiKey() {
  return (process.env.PLACES_API_KEY ?? process.env.GOOGLE_PLACES_API_KEY ?? '').trim();
}

function openaiKey() {
  return (process.env.OPENAI_API_KEY ?? process.env.OPENAI_KEY)?.trim();
}

function inferGl(country, aiGl) {
  if (aiGl) return String(aiGl).trim().toLowerCase();
  const key = normalizePlaceKey(country);
  return COUNTRY_GL[key] || null;
}

function isRolePhrase(phrase) {
  const words = normalizePlaceKey(phrase).split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => ROLE_WORDS.has(w));
}

/**
 * Soft extract: pull candidate place phrases from the query.
 * Does NOT require the place to be in a known dictionary (typos allowed).
 */
export function extractPlacePhrases(query) {
  const text = String(query ?? '').trim();
  if (!text) return [];

  const phrases = [];
  const push = (p) => {
    let t = String(p ?? '').trim();
    // Strip leading prepositions if extract was messy.
    t = t.replace(/^(?:in|near|around|from|based in)\s+/i, '').trim();
    if (!t || t.length < 2 || isRolePhrase(t)) return;
    const words = normalizePlaceKey(t).split(/\s+/);
    // Drop if any token is a job/role word (keeps "New York", drops "Karachi producers").
    if (words.some((w) => ROLE_WORDS.has(w))) return;
    if (!phrases.some((x) => normalizePlaceKey(x) === normalizePlaceKey(t))) {
      phrases.push(t);
    }
  };

  // Primary: "in/near/around/from <place>"
  const inPlace = text.match(
    /\b(?:in|near|around|from|based in)\s+([A-Za-z][A-Za-z\s.'-]{1,40}?)(?:\s*[,.]?\s*$|\s+(?:who|with|looking|seeking|for)\b)/i,
  );
  if (inPlace) push(inPlace[1]);

  // Known dictionary label only (not the whole query).
  const hint = extractQueryLocation(text);
  if (hint?.label) push(hint.label);

  // Trailing place words (1–2), skipping role words at the end.
  const parts = text.split(/\s+/);
  const last = parts[parts.length - 1] || '';
  const prev = parts[parts.length - 2] || '';
  if (last && !ROLE_WORDS.has(normalizePlaceKey(last))) {
    if (prev && !ROLE_WORDS.has(normalizePlaceKey(prev)) && !/^(in|near|around|from)$/i.test(prev)) {
      push(`${prev} ${last}`);
    } else {
      push(last);
    }
  } else if (prev && !ROLE_WORDS.has(normalizePlaceKey(prev))) {
    push(prev);
  }

  // Leading place before role: "Karachii insurance producers"
  const leading = text.match(
    /^([A-Za-z][A-Za-z.'-]{1,30}(?:\s+[A-Za-z][A-Za-z.'-]{1,20})?)\s+(?:insurance|finance|sales|producer|producers|agent|agents|graduate|major|claims)/i,
  );
  if (leading) push(leading[1]);

  return phrases;
}

/** Soft: any place-like phrase we can try (even typos). */
export function queryMentionsGeographicPlace(query) {
  return extractPlacePhrases(query).length > 0;
}

function scopeFromPlaces(display, country, city) {
  const d = normalizePlaceKey(display);
  const c = normalizePlaceKey(country);
  if (d && (KNOWN_COUNTRIES.has(d) || d === c)) return 'country';
  if (c && KNOWN_COUNTRIES.has(c) && (!city || normalizePlaceKey(city) === c)) return 'country';
  return 'city';
}

function locationFromPlaces(placesLoc) {
  if (!placesLoc) return null;
  const scope = scopeFromPlaces(placesLoc.label, placesLoc.country, placesLoc.city);
  const country = placesLoc.country || null;
  const city = scope === 'city' ? placesLoc.city : null;
  const mustInclude = scope === 'country' ? [] : normList([city || placesLoc.label]);

  return {
    label: placesLoc.label,
    gl: placesLoc.gl || inferGl(country, null),
    serpLocation: toSerpApiLocation(placesLoc.serpLocation || placesLoc.label),
    tokens: normList([placesLoc.label, city, country, ...mustInclude]),
    mustInclude,
    scope,
    city,
    country,
    source: 'places',
  };
}

function locationFromAi(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const city = String(raw.city ?? '').trim();
  const country = String(raw.country ?? '').trim();
  const label = String(raw.label ?? city ?? country ?? '').trim();
  if (!label && !city && !country) return null;

  const scopeRaw = String(raw.scope ?? '').trim().toLowerCase();
  const must = normList(raw.must_match ?? raw.mustInclude);
  const filterTokens = normList(
    raw.filter_tokens ?? raw.filterTokens ?? raw.tokens ?? [...must, city, country, label],
  );

  const scope =
    scopeRaw === 'country' || scopeRaw === 'region'
      ? 'country'
      : scopeRaw === 'city'
        ? 'city'
        : must.length
          ? 'city'
          : country && !city
            ? 'country'
            : 'city';

  return {
    label: label || city || country,
    gl: inferGl(country, raw.gl),
    serpLocation:
      String(raw.serp_location ?? raw.serpLocation ?? '').trim()
      || (city && country ? `${city}, ${country}` : label),
    tokens: filterTokens.length ? filterTokens : normList([city, country, label]),
    mustInclude: scope === 'country' ? [] : must.length ? must : normList([city || label]),
    scope,
    city: city || null,
    country: country || null,
    source: 'ai',
  };
}

/**
 * Google Places types that describe a geographic area. A role word that leaks
 * into the place candidates ("financial", "nurse") still matches a nearby
 * *business* in Text Search, and using that as a city filter silently returns
 * zero leads — so only areas may become a location filter.
 */
const GEOGRAPHIC_PLACE_TYPES = new Set([
  'country',
  'administrative_area_level_1',
  'administrative_area_level_2',
  'administrative_area_level_3',
  'locality',
  'postal_town',
  'sublocality',
  'sublocality_level_1',
  'neighborhood',
  'archipelago',
  'continent',
  'political',
]);

function isGeographicPlace(types) {
  const list = Array.isArray(types) ? types : [];
  if (list.includes('establishment') || list.includes('point_of_interest')) return false;
  return list.some((type) => GEOGRAPHIC_PLACE_TYPES.has(type));
}

async function geocodeWithPlaces(placePhrase, apiKey) {
  const trimmed = String(placePhrase ?? '').trim();
  if (!trimmed || !apiKey) return null;

  try {
    const res = await fetch(GOOGLE_PLACES_TEXT_SEARCH, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.types',
      },
      body: JSON.stringify({ textQuery: trimmed }),
      signal: AbortSignal.timeout(Number(process.env.PLACES_TIMEOUT_MS ?? 8_000)),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const place = (data?.places ?? []).find((candidate) => isGeographicPlace(candidate?.types));
    if (!place) return null;

    const display = place.displayName?.text ?? '';
    const formatted = place.formattedAddress ?? '';
    const parts = formatted.split(',').map((s) => s.trim()).filter(Boolean);
    const country = parts.length ? parts[parts.length - 1] : '';
    const city = parts.length > 1 ? parts[0] : display;

    return {
      label: display || trimmed,
      city: normalizePlaceKey(city),
      country: normalizePlaceKey(country),
      serpLocation: formatted || display || trimmed,
      gl: inferGl(country, null),
      source: 'places',
    };
  } catch {
    return null;
  }
}

/** Try Places on each extracted phrase until one hits. */
async function resolveWithPlaces(phrases, { onLog } = {}) {
  const key = placesApiKey();
  if (!key) {
    onLog?.('  Places: no API key — skipping to AI fallback');
    return null;
  }

  for (const phrase of phrases) {
    onLog?.(`  Places: trying "${phrase}"...`);
    const hit = await geocodeWithPlaces(phrase, key);
    if (hit) {
      onLog?.(`  Places: matched ${hit.serpLocation}`);
      return locationFromPlaces(hit);
    }
  }
  onLog?.('  Places: no match');
  return null;
}

/** AI-only location interpretation when Places missed. */
async function resolveLocationWithAi(userQuery, phrases, { onLog } = {}) {
  if (!openaiAvailable() || !openaiKey()) return null;

  onLog?.('  AI location fallback...');
  const model = process.env.OPENAI_PLAN_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  const prompt = [
    'Resolve the geographic place in this recruiter search query.',
    'Output JSON only.',
    '',
    `Query: "${userQuery}"`,
    `Candidate phrases: ${JSON.stringify(phrases)}`,
    '',
    'Schema:',
    '{',
    '  "is_place": true|false,',
    '  "label": "Karachi",',
    '  "scope": "country"|"city"|"region",',
    '  "city": "Karachi"|null,',
    '  "country": "Pakistan",',
    '  "must_match": [] for country OR ["karachi"] for city,',
    '  "filter_tokens": ["karachi","pakistan","pakistani",...],',
    '  "gl": "pk",',
    '  "serp_location": "Karachi, Pakistan"',
    '}',
    '',
    'Rules:',
    '- If candidates are typos of real places, correct them.',
    '- If nothing is a place (job titles only), set is_place=false and other fields null.',
    '- Never invent a place that is not implied by the query/candidates.',
    '- Country: must_match=[], filter_tokens = country + major cities.',
    '- City: must_match includes city name.',
  ].join('\n');

  try {
    const res = await fetch(OPENAI_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey()}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: 'You resolve places for recruiter searches. JSON only. Never invent places not implied by the query.',
          },
          { role: 'user', content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(Number(process.env.OPENAI_TIMEOUT_MS ?? 45_000)),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const parsed = parseJsonFromText(data?.choices?.[0]?.message?.content ?? '');
    if (!parsed || parsed.is_place === false) return null;
    return locationFromAi(parsed);
  } catch {
    return null;
  }
}

/** Attach AI country city expansion onto a Places (or AI) base location. */
export function mergeFilterTokens(baseLocation, aiLocationRaw) {
  if (!baseLocation) return null;
  const ai = locationFromAi(aiLocationRaw);
  if (!ai?.tokens?.length) return baseLocation;

  return {
    ...baseLocation,
    tokens: [...new Set([...(baseLocation.tokens || []), ...ai.tokens])],
    // Scope / mustInclude stay Places-primary (or AI-fallback primary).
    mustInclude: baseLocation.mustInclude,
    scope: baseLocation.scope,
    gl: baseLocation.gl || ai.gl,
    serpLocation: baseLocation.serpLocation || ai.serpLocation,
    source: `${baseLocation.source}+tokens`,
  };
}

/**
 * Resolve a location the user picked from the Places dropdown.
 * Role text is never involved — only the selected place goes to Places.
 */
export async function resolveFromUiLocation(uiLocation, { onLog } = {}) {
  if (!uiLocation || typeof uiLocation !== 'object') {
    return { location: null, stripped: false, source: 'none', phrases: [] };
  }

  const label =
    String(uiLocation.label || uiLocation.mainText || uiLocation.formattedAddress || '').trim();
  const placeId = String(uiLocation.placeId || '').trim();
  if (!label && !placeId) {
    return { location: null, stripped: false, source: 'none', phrases: [] };
  }

  onLog?.(`  location from UI: ${label || placeId}`);

  // Prefer details already fetched by the frontend.
  if (uiLocation.country || uiLocation.city || uiLocation.scope) {
    const scope = String(uiLocation.scope || '').toLowerCase() === 'country' ? 'country' : 'city';
    const cityRaw = uiLocation.city || uiLocation.mainText || String(label).split(',')[0];
    const city = cityRaw ? normalizePlaceKey(cityRaw) : null;
    const country = uiLocation.country || null;
    // City filter must be the city token only — never "islamabad, pakistan".
    const mustInclude = scope === 'country' ? [] : normList([city].filter(Boolean));
    const location = {
      label: label || city || country,
      gl: inferGl(country, uiLocation.countryCode),
      serpLocation: toSerpApiLocation(uiLocation.formattedAddress || label),
      tokens: normList([label, city, country, uiLocation.region, ...mustInclude]),
      mustInclude,
      scope,
      city,
      country: country ? normalizePlaceKey(country) : null,
      source: 'ui+places',
    };
    const scopeNote = location.scope === 'country' ? ' (any city in country)' : ' (city strict)';
    onLog?.(`  location: ${location.label}${scopeNote} [${location.source}]`);
    return { location, stripped: false, source: location.source, phrases: [label] };
  }

  // Resolve via Places using placeId label / text search.
  const key = placesApiKey();
  if (key) {
    const phrase = label || placeId;
    onLog?.(`  Places: resolving selected "${phrase}"...`);
    const hit = await geocodeWithPlaces(phrase, key);
    if (hit) {
      const location = locationFromPlaces(hit);
      const scopeNote = location.scope === 'country' ? ' (any city in country)' : ' (city strict)';
      onLog?.(`  location: ${location.label}${scopeNote} [ui+places]`);
      return { location: { ...location, source: 'ui+places' }, stripped: false, source: 'ui+places', phrases: [phrase] };
    }
  }

  // Soft fallback: use the label as a city-strict filter.
  const location = {
    label,
    gl: inferGl(uiLocation.country, uiLocation.countryCode),
    serpLocation: toSerpApiLocation(label),
    tokens: normList([label, uiLocation.mainText, uiLocation.secondaryText]),
    mustInclude: normList([uiLocation.mainText || label]),
    scope: 'city',
    city: normalizePlaceKey(uiLocation.mainText || label),
    country: uiLocation.country ? normalizePlaceKey(uiLocation.country) : null,
    source: 'ui',
  };
  onLog?.(`  location: ${location.label} (city strict) [ui]`);
  return { location, stripped: false, source: 'ui', phrases: [label] };
}

/**
 * Resolve location: UI selection (preferred) OR extract → Places → AI fallback.
 */
export async function resolveLocationHybrid(userQuery, aiLocationRaw = null, { onLog, uiLocation } = {}) {
  if (uiLocation) {
    return resolveFromUiLocation(uiLocation, { onLog });
  }

  const query = String(userQuery ?? '').trim();
  const phrases = extractPlacePhrases(query);
  const aiHadLocation =
    aiLocationRaw
    && typeof aiLocationRaw === 'object'
    && (aiLocationRaw.label || aiLocationRaw.city || aiLocationRaw.country);

  // No place-like phrase at all → never invent a location.
  if (phrases.length === 0) {
    if (aiHadLocation) onLog?.('  location: no place phrase in query (ignored AI guess)');
    return { location: null, stripped: Boolean(aiHadLocation), source: 'none', phrases: [] };
  }

  onLog?.(`  place candidates: ${phrases.join(', ')}`);

  // 1) Places primary
  let location = await resolveWithPlaces(phrases, { onLog });
  let source = location?.source || null;

  // 2) AI fallback if Places missed
  if (!location) {
    location = await resolveLocationWithAi(query, phrases, { onLog });
    source = location ? 'ai-fallback' : null;

    if (!location) {
      location = locationFromAi(aiLocationRaw);
      if (location) source = 'ai-plan';
    }
    if (!location) {
      const regexLoc = extractQueryLocation(query);
      if (regexLoc) {
        location = { ...regexLoc, source: 'regex' };
        source = 'regex';
      }
    }
  } else if (aiLocationRaw) {
    location = mergeFilterTokens(location, aiLocationRaw);
    source = location.source;
  }

  if (!location) {
    onLog?.('  location: unresolved');
    return { location: null, stripped: false, source: 'unresolved', phrases };
  }

  const scopeNote = location.scope === 'country' ? ' (any city in country)' : ' (city strict)';
  onLog?.(`  location: ${location.label}${scopeNote} [${source}]`);

  return { location, stripped: false, source, phrases };
}
