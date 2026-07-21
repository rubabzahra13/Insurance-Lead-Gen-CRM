// USA recall expansion — small cities rarely have indexed LinkedIn profiles.
// Adds metro + state fallback search phrases for sales / finance / insurance.

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

/** Major metros per state — used when the selected city is too small for LinkedIn recall. */
const USA_STATE_METROS = {
  alabama: ['Birmingham', 'Huntsville'],
  alaska: ['Anchorage'],
  arizona: ['Phoenix', 'Tucson'],
  arkansas: ['Little Rock'],
  california: ['Los Angeles', 'San Francisco', 'San Diego'],
  colorado: ['Denver'],
  connecticut: ['Hartford', 'New Haven'],
  delaware: ['Wilmington'],
  florida: ['Miami', 'Tampa', 'Orlando'],
  georgia: ['Atlanta'],
  hawaii: ['Honolulu'],
  idaho: ['Boise'],
  illinois: ['Chicago'],
  indiana: ['Indianapolis'],
  iowa: ['Des Moines'],
  kansas: ['Kansas City', 'Wichita'],
  kentucky: ['Louisville', 'Lexington'],
  louisiana: ['New Orleans', 'Baton Rouge'],
  maine: ['Portland'],
  maryland: ['Baltimore'],
  massachusetts: ['Boston'],
  michigan: ['Detroit', 'Grand Rapids'],
  minnesota: ['Minneapolis'],
  mississippi: ['Jackson'],
  missouri: ['Kansas City', 'St. Louis'],
  montana: ['Billings'],
  nebraska: ['Omaha', 'Lincoln'],
  nevada: ['Las Vegas', 'Reno'],
  'new hampshire': ['Manchester'],
  'new jersey': ['Newark', 'Jersey City'],
  'new mexico': ['Albuquerque'],
  'new york': ['New York', 'Buffalo'],
  'north carolina': ['Charlotte', 'Raleigh'],
  'north dakota': ['Fargo'],
  ohio: ['Columbus', 'Cleveland', 'Cincinnati'],
  oklahoma: ['Oklahoma City', 'Tulsa'],
  oregon: ['Portland'],
  pennsylvania: ['Philadelphia', 'Pittsburgh'],
  'rhode island': ['Providence'],
  'south carolina': ['Charleston', 'Columbia'],
  'south dakota': ['Sioux Falls'],
  tennessee: ['Nashville', 'Memphis'],
  texas: ['Dallas', 'Houston', 'Austin', 'San Antonio'],
  utah: ['Salt Lake City'],
  vermont: ['Burlington'],
  virginia: ['Richmond', 'Virginia Beach'],
  washington: ['Seattle', 'Spokane'],
  'west virginia': ['Charleston'],
  wisconsin: ['Milwaukee', 'Madison'],
  wyoming: ['Cheyenne'],
  'district of columbia': ['Washington'],
};

/** Micro-cities → nearest metro (overrides state list when known). */
const MICRO_CITY_METRO = {
  'virginia city': 'Reno',
  'carson city': 'Reno',
};

function normKey(value) {
  return String(value || '').trim().toLowerCase();
}

export function isUsaLocation(location) {
  if (!location) return false;
  if (location.gl === 'us') return true;
  const label = normKey(location.label);
  const country = normKey(location.country);
  return label.includes('united states') || label.includes(' usa') || country === 'united states' || country === 'usa';
}

export function parseUsaState(location) {
  const abbr = String(location?.state || location?.region || '').trim().toUpperCase();
  if (abbr && US_STATE_NAMES[abbr]) {
    return { abbr, name: US_STATE_NAMES[abbr], key: normKey(US_STATE_NAMES[abbr]) };
  }

  const label = String(location?.label || '');
  const m = label.match(/,\s*([A-Za-z]{2})\s*,?\s*(?:USA|United States)?/i);
  if (m && US_STATE_NAMES[m[1].toUpperCase()]) {
    const name = US_STATE_NAMES[m[1].toUpperCase()];
    return { abbr: m[1].toUpperCase(), name, key: normKey(name) };
  }

  for (const [key, name] of Object.entries(US_STATE_NAMES)) {
    if (label.toLowerCase().includes(name.toLowerCase())) {
      return { abbr: key, name, key: normKey(name) };
    }
  }
  return null;
}

/**
 * Extra location phrases for USA city searches — metro then state.
 * @returns {Array<{ type: 'metro'|'state', phrase: string, mustInclude: string[], serpLocation?: string, note: string }>}
 */
export function usaLocationFallbacks(location) {
  if (!isUsaLocation(location) || location.scope !== 'city' || !isSmallUsaCity(location)) return [];

  const cityKey = normKey(location.city || location.label?.split(',')[0]);
  const state = parseUsaState(location);
  if (!state) return [];

  const out = [];
  const cityLower = cityKey.replace(/\s+/g, ' ');

  const microMetro = MICRO_CITY_METRO[cityLower];
  if (microMetro) {
    out.push({
      type: 'metro',
      phrase: `"${microMetro}"`,
      mustInclude: [microMetro.toLowerCase()],
      serpLocation: `${microMetro}, ${state.name}, United States`,
      note: `USA metro recall (${microMetro} — near ${location.city || cityLower})`,
    });
  } else {
    const metros = (USA_STATE_METROS[state.key] || []).filter((m) => normKey(m) !== cityLower);
    for (const metro of metros.slice(0, 2)) {
      out.push({
        type: 'metro',
        phrase: `"${metro}"`,
        mustInclude: [metro.toLowerCase()],
        serpLocation: `${metro}, ${state.name}, United States`,
        note: `USA metro recall (${metro}, ${state.abbr})`,
      });
    }
  }

  out.push({
    type: 'state',
    phrase: `"${state.name}"`,
    mustInclude: [state.key, state.abbr.toLowerCase()],
    serpLocation: `${state.name}, United States`,
    note: `USA state-wide recall (${state.name})`,
  });

  return out;
}

export function isSmallUsaCity(location) {
  if (!isUsaLocation(location) || location.scope !== 'city') return false;
  const cityKey = normKey(location.city || location.label?.split(',')[0]);
  if (MICRO_CITY_METRO[cityKey]) return true;
  // Heuristic: if we have state metros and city isn't one of them, treat as small-market.
  const state = parseUsaState(location);
  if (!state) return false;
  const metros = USA_STATE_METROS[state.key] || [];
  return !metros.some((m) => normKey(m) === cityKey);
}
