export function toFriendlyTrace(raw) {
  if (!raw || typeof raw !== 'string') return 'Working...';

  if (raw.startsWith('[INIT]')) {
    const match = raw.match(/query: "(.+?)"/i);
    return match ? `Starting search for "${match[1]}"` : 'Starting your lead search';
  }
  if (raw.includes('Building search plan') || raw.includes('search checklist')) {
    return 'AI is building custom searches and a checklist from your query';
  }
  if (raw.includes('AI-tailored search lanes')) {
    return 'AI wrote custom searches for your query';
  }
  if (raw.includes('Resolving location') || raw.includes('Places:') || raw.includes('place candidates')) {
    return 'Resolving location from your selection';
  }
  if (raw.includes('AI location fallback')) {
    return 'Places had no match. AI is resolving the location';
  }
  if (raw.includes('none in query (ignored AI guess)')) {
    return 'No location in your query. Searching without a place filter';
  }
  if (raw.includes('Engine: Google search') || raw.includes('Engine: SERP') || raw.includes('Engine: Profile search')) {
    return 'Using profile search with AI filtering';
  }
  if (raw.includes('AI quality filter') || raw.includes('LLM filter')) {
    return 'AI is reviewing candidates against the checklist';
  }
  if (raw.includes('code filter dropped')) {
    return raw.replace('[SCRAPER] ', '').replace('[LOG] ', '');
  }
  if (raw.includes('Stage 1') || raw.includes('Classification')) {
    return 'Understanding whether this search targets job seekers or job upgraders';
  }
  if (
    raw.includes('Starting Google search')
    || raw.includes('Starting profile search')
    || raw.includes('Sourcing individual')
  ) {
    return 'Searching for matching LinkedIn profiles';
  }
  if (raw.startsWith('[SUCCESS] Classification')) {
    return 'Lead type identified successfully';
  }
  if (raw.startsWith('[INFO] Lead type:')) {
    return `Searching for ${raw.replace('[INFO] Lead type: ', '').replace(/ \(selected workspace\)$/, '')}`;
  }
  if (raw.startsWith('[INFO] LLM Confidence:')) {
    return `AI confidence: ${raw.replace('[INFO] LLM Confidence: ', '')}`;
  }
  if (raw.startsWith('[INFO] Claude Reasoning:')) {
    return `Reasoning: ${raw.replace('[INFO] Claude Reasoning: ', '')}`;
  }
  if (raw.startsWith('[LOG] Search job created:') || raw.startsWith('[LOG] Scraper job created:')) {
    return 'Search queued. Gathering profile results';
  }
  if (raw.startsWith('[LOG] Listening for live') || raw.startsWith('[LOG] Listening to SSE')) {
    return 'Connected to live progress';
  }
  if (raw.startsWith('[LOG] Submitting search') || raw.startsWith('[LOG] Submitting scrape')) {
    return 'Sending search request';
  }
  if (raw.startsWith('[SUCCESS] Lead search finished') || raw.startsWith('[SUCCESS] Scraper pipeline finished')) {
    return 'Search finished';
  }
  if (raw.startsWith('[LOG] Synced & imported')) {
    const match = raw.match(/(\d+) individual leads/);
    return match ? `Imported ${match[1]} profiles into your drafts` : 'Imported new profiles into your drafts';
  }
  if (raw.startsWith('[LOG] First ') && raw.includes('candidates found')) {
    return raw.replace('[LOG] ', '');
  }
  if (raw.startsWith('[ERROR] Classification')) {
    return 'Classification service unavailable — using backup logic';
  }
  if (raw.startsWith('[ERROR]')) {
    return raw.replace('[ERROR] ', 'Something went wrong: ');
  }
  if (raw.startsWith('[WARNING]')) {
    return raw.replace('[WARNING] ', 'Note: ');
  }
  if (raw.startsWith('[HEURISTIC]')) {
    return `Backup classification: ${raw.replace('[HEURISTIC] Lead type: ', '')}`;
  }
  if (raw.startsWith('[OVERRIDE]')) {
    return raw.replace('[OVERRIDE] User manually switched lead type to: ', 'You switched lead type to ');
  }
  if (raw.startsWith('[SCRAPER]')) {
    return raw.replace('[SCRAPER] ', '');
  }
  if (raw.startsWith('→ Pipeline Step Start:')) {
    const step = raw
      .replace('→ Pipeline Step Start: ', '')
      .replace(/Fast Google search/i, 'Profile search')
      .replace(/Google search/i, 'Profile search');
    return `Now running: ${step}`;
  }
  if (raw.startsWith('✓ Pipeline Step Done:')) {
    const step = raw
      .replace('✓ Pipeline Step Done: ', '')
      .replace(/\s*\(\d+s\)$/, '')
      .replace(/Fast Google search/i, 'Profile search')
      .replace(/Google search/i, 'Profile search');
    return `Completed: ${step}`;
  }
  if (raw.startsWith('[INFO]')) {
    return raw.replace('[INFO] ', '');
  }
  if (raw.startsWith('[LOG]')) {
    return raw.replace('[LOG] ', '');
  }
  if (raw.startsWith('[SUCCESS]')) {
    return raw.replace('[SUCCESS] ', '');
  }
  if (raw.startsWith('[STEP]')) {
    return raw.replace('[STEP] ', '');
  }

  return raw.replace(/^\[[A-Z_]+\]\s*/, '');
}

export function traceLevel(raw) {
  if (!raw) return 'info';
  if (raw.startsWith('[ERROR]')) return 'error';
  if (raw.startsWith('[SUCCESS]') || raw.startsWith('✓')) return 'success';
  if (raw.startsWith('[WARNING]')) return 'warning';
  if (raw.startsWith('[STEP]') || raw.startsWith('→')) return 'step';
  return 'info';
}
