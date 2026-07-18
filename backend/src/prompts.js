export function buildGoogleQuery(searchPrompt) {
  return `site:linkedin.com/in ${searchPrompt}`;
}

export function searchOnlyPrompt(searchPrompt, recipe = null) {
  const googleQuery = buildGoogleQuery(searchPrompt);
  const searchInstructions = recipe
    ? [recipe, '', 'Include every matching person you see on each search results page — do not skip profiles on a page.']
    : [
        `Search the web for LinkedIn profiles matching: "${googleQuery}"`,
        'Run up to 3 searches if needed. Focus on linkedin.com/in profile pages.',
        'Include every matching person you see on each search results page — do not skip profiles on a page.',
      ];

  return [
    ...searchInstructions,
    '',
    'After searching, write a detailed profile list. For EACH person you MUST include:',
    '- name, job title, company, location (city/region/country)',
    '- the grey description/snippet text from the search result (the text under the blue title link) —',
    '  this is where locations like "Lahore, Punjab, Pakistan" and roles like "Founder & CEO" appear',
    '- the linkedin.com/in profile URL',
    ...(recipe
      ? [
          '- fit evidence: the exact text proving they match the target (quote it verbatim),',
          '  and which page it came from (their profile / their own post / a company page / other)',
          '- past experience: previous roles or employers, only if the result text states them',
        ]
      : []),
    '',
    'Copy facts from search results only. Include the grey snippet text verbatim or closely paraphrased.',
    '',
    'CRITICAL: Your final response MUST be the written profile list. Do not stop after tool calls only.',
  ].join('\n');
}

export function expandSearchNotesPrompt(searchPrompt, profileItems) {
  const lines = profileItems
    .slice(0, 30)
    .map((item) => `- ${item.title} | ${item.url}`)
    .join('\n');

  return [
    `You already searched for: "${searchPrompt}"`,
    'These LinkedIn profiles were found but lack detail. For each person below, use web search to find their',
    'grey description snippet (the text under the title in search results) and write a complete profile list.',
    '',
    'For EACH person include: name, job title, company, location (city/region), grey snippet description, linkedin URL.',
    '',
    'Profiles found:',
    lines,
    '',
    'Write the full profile list now. Include location when the grey text mentions it.',
  ].join('\n');
}

function pickDescription(...values) {
  const cleaned = values.map((v) => v?.trim()).filter(Boolean);
  if (cleaned.length === 0) return '';
  return cleaned.sort((a, b) => b.length - a.length)[0];
}

export function prepareStructureItems(rawItems) {
  const profiles = rawItems.filter((item) => item.title !== 'model_research_notes');
  const researchNotes = rawItems.find((item) => item.title === 'model_research_notes')?.snippet?.trim() ?? '';
  const withDescription = profiles.filter((item) => item.snippet?.trim()).length;
  const sparseDescriptions = profiles.length > 0 && withDescription / profiles.length < 0.3;

  return { profiles, researchNotes, sparseDescriptions };
}

export function structureLeadsPrompt(rawItems, searchPrompt, maxResults = 10, structureContext = null) {
  const { profiles, researchNotes, sparseDescriptions } = prepareStructureItems(rawItems);

  const profileBlocks = profiles.map(
    (item) => `[${item.id}]\ntitle: ${item.title}\nurl: ${item.url}`,
  );

  const sections = [];

  if (researchNotes) {
    sections.push(
      '# research_notes (PRIMARY SOURCE)',
      'These notes were written after search and include the grey description text under each result —',
      'job titles, companies, locations, and bios that do NOT appear in the title line alone.',
      researchNotes,
    );
  }

  if (sparseDescriptions && researchNotes) {
    sections.push(
      '',
      '# IMPORTANT — how to read these results',
      'The search API only returns a title + URL per LinkedIn hit. It does NOT pass the grey snippet text separately.',
      'That grey text (e.g. "Founder & CEO · Aimployeed · Lahore, Punjab, Pakistan") lives in research_notes above.',
      'Extract name, title, company, and location from research_notes. Match each person to their linkedin.com/in URL.',
      'The title/url entries below are for link matching only — ignore empty descriptions.',
    );
  }

  if (profileBlocks.length > 0) {
    sections.push('', '# LinkedIn result titles and URLs', profileBlocks.join('\n\n'));
  }

  return [
    '# Role',
    'You extract structured lead data from LinkedIn web search results.',
    'Grey description text under each search result contains title, company, and location — read it carefully.',
    'Never invent from memory.',
    '',
    `# Search intent: "${searchPrompt}"`,
    '',
    ...(structureContext ? [structureContext, ''] : []),
    ...sections,
    '',
    `# Task`,
    `Extract up to ${maxResults} real people who match the search intent.`,
    '',
    'For each person fill in (same approach for every field — read, understand, normalize):',
    '- name',
    '- title: from grey description text or research_notes — not just the blue title line',
    '- company: from grey description text or research_notes',
    '- location: from grey description text or research_notes (e.g. "Lahore, Punjab, Pakistan")',
    '- link: linkedin.com/in URL copied exactly from results | null',
    '- snippet: 1 sentence summary',
    '- evidence: short quote from research_notes or description supporting title + company',
    ...(structureContext
      ? ['- past_experience, fit_evidence, fit_source, weak_fields: as defined in the avatar context above']
      : []),
    '',
    '# Rules',
    '1. research_notes is the main source when per-result descriptions are missing.',
    '2. null only when a field truly does not appear anywhere in the results.',
    '3. link must appear verbatim in the results.',
    '4. Skip people who do not match the search intent.',
    '5. If the search intent names a location, skip anyone whose result text places',
    '   them elsewhere (wrong country/city). Do not invent a matching location.',
    '',
    'Return JSON array only. No markdown.',
    structureContext
      ? '[{"name":"...","title":"...","company":"...","location":"...","link":null,"snippet":"...","evidence":"...","past_experience":null,"fit_evidence":"...","fit_source":"profile","weak_fields":[]}]'
      : '[{"name":"...","title":"...","company":"...","location":"...","link":null,"snippet":"...","evidence":"..."}]',
  ].join('\n');
}

export function researchPrompt(searchPrompt, maxResults = 10) {
  const googleQuery = buildGoogleQuery(searchPrompt);
  return [
    '# Role',
    'You are LeadScout, a B2B lead extraction agent. You are a TRANSCRIBER, not an author:',
    'every value you output must be copied (or minimally trimmed) from text you actually',
    'saw in web search results. You never add knowledge from memory.',
    '',
    '# Task',
    `Search the web for: "${googleQuery}"`,
    'You may run up to 2 refined follow-up searches if the first returns few people.',
    'Prefer results that are linkedin.com/in profile pages. Include every matching person visible on each results page.',
    '',
    `Extract up to ${maxResults} real people matching the search.`,
    '',
    '# Field contract (per person)',
    '- name: as written in the search result (required)',
    '- title: job title as written in the result | null if the result does not state it',
    '- company: the person\'s CURRENT EMPLOYER organization name (not a product, location,',
    '  event, or surname). Extract by reading the result text:',
    '  • LinkedIn titles "Name - CEO - Acme Corp | LinkedIn" → company is "Acme Corp"',
    '  • "CEO of Acme", "founder at Acme", "CEO @ Acme" → company is Acme',
    '  • Funding/news lines "Name – Company. Recent Transaction..." → company is Company',
    '  Copy the org name as written. | null if no employer is stated',
    '- location: where THIS PERSON is based, only if a result states it about them.',
    '  The location in my search query is a FILTER, not data — never copy it into this field.',
    '  | null if not stated',
    '- snippet: 1-2 sentences copied from the result that mention this person',
    '- evidence: exact quote from the result proving the title/company claim',
    '- link: a linkedin.com/in URL copied CHARACTER-FOR-CHARACTER from the results.',
    '  Never construct, complete, or guess URL endings — inventing slug suffixes like',
    '  "-78848a12" is the worst possible failure. | null if no profile URL appeared',
    '',
    '# Hard rules',
    '1. If the results do not state it, the value is null. A null is correct; a guess is a lie.',
    '2. Never invent people, companies, titles, locations, or URLs.',
    '3. Matching my search criteria is not evidence. Only result text counts.',
    '4. Company must not be a person\'s last name unless the result explicitly uses it as a company name.',
    '',
    '# Self-check before answering',
    'For every value, ask: "Can I point to the exact search result text containing this?"',
    'If not, replace it with null. Drop any person whose name fails this test.',
    '',
    '# Output',
    'JSON array only. No markdown, no commentary.',
    'Example of a correct entry (note the honest nulls):',
    '{"name":"Jane Doe","title":"CEO","company":"Acme","location":null,"snippet":"Jane Doe, CEO of Acme, raised a $10M Series A.","evidence":"Jane Doe, CEO of Acme","link":null}',
  ].join('\n');
}

export function batchLinkResolverPrompt(leads) {
  const people = leads
    .map(
      (lead) =>
        `- ${lead.name}${lead.title ? `, ${lead.title}` : ''}${lead.company ? ` at ${lead.company}` : ''}`,
    )
    .join('\n');

  return [
    'You are a LinkedIn URL resolver agent. Wrong-person matches are worse than no match.',
    'For each person below, search the web:',
    'site:linkedin.com/in "<name>" <company>',
    '',
    people,
    '',
    'MATCH RULES — a link only counts when ALL are true:',
    '1. The profile URL appears in actual search results. Copy it character-for-character; never construct, complete, or append digits to a slug.',
    "2. The search result's title/snippet confirms the SAME person: matching company or job title, not just the same name.",
    '3. If the result shows a different company or role than listed above, it is a different person — return null for them.',
    '',
    'Return a JSON array (no markdown):',
    '[{"name":"...","link":"https://www.linkedin.com/in/...","match_reason":"result shows CEO at <company>"}]',
    'Use "link": null when there is no confident match. Omitting or nulling a person is always safer than a wrong link.',
  ].join('\n');
}

export function companyRefinementPrompt(leads) {
  const blocks = leads.map((lead, index) => {
    const sourceText = [lead.source, lead.snippet, lead.evidence, lead.searchResultTitle]
      .filter(Boolean)
      .join('\n');

    return [
      `### Person ${index + 1}`,
      `name: ${lead.name}`,
      'source_text:',
      '"""',
      sourceText || '(no source text)',
      '"""',
    ].join('\n');
  });

  return [
    'You extract employer company names from search result text. You read and interpret;',
    'you do not invent. The ONLY allowed evidence is the source_text below.',
    '',
    'For each person, determine their current employer organization from source_text.',
    '',
    blocks.join('\n\n'),
    '',
    'Return a JSON array (no markdown):',
    '[{"name":"...","company":"Acme Corp","company_evidence":"exact quote from source_text"}]',
    '',
    'Rules:',
    '- company = organization they work for NOW (employer), not a city, product, or person\'s surname',
    '- Read LinkedIn title patterns: "Name - Title - Company" or "Name - Title @ Company"',
    '- Read prose: "CEO of X", "founder at X", "president of X"',
    '- company_evidence MUST be copied verbatim from source_text (substring)',
    '- If source_text does not state an employer, use "company": null and "company_evidence": null',
    '- Never use the person\'s last name as the company unless source_text clearly names a company that',
    '',
    'Include every person listed above.',
  ].join('\n');
}

export function singleLinkResolverPrompt(lead) {
  const company = lead.company ? ` at ${lead.company}` : '';
  const title = lead.title ? ` (${lead.title})` : '';

  return [
    'You are a LinkedIn URL resolver agent. Wrong-person matches are worse than no match.',
    `Find the public LinkedIn profile for: ${lead.name}${company}${title}`,
    `Search the web: site:linkedin.com/in "${lead.name}" ${lead.company ?? ''}`,
    '',
    'MATCH RULES — a link only counts when ALL are true:',
    '1. The profile URL appears in actual search results (never construct or guess slugs).',
    `2. The search result's title/snippet confirms this person${company ? ` works at ${lead.company.trim()}` : ''}${title ? ` as ${lead.title.trim()}` : ''} — same name alone is NOT enough.`,
    '3. If the result shows a different company or role, it is a different person with the same name — return null.',
    '',
    'Return JSON only (no markdown):',
    '{"name":"...","link":"https://www.linkedin.com/in/...","match_reason":"..."}',
    'If no confident match exists, return: {"name":"...","link":null}',
  ].join('\n');
}
