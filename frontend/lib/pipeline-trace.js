export function toFriendlyTrace(raw) {
  if (!raw || typeof raw !== 'string') return 'Working...';

  if (raw.startsWith('[INIT]')) {
    const match = raw.match(/query: "(.+?)"/i);
    return match ? `Starting search for "${match[1]}"` : 'Starting your lead search';
  }
  if (raw.includes('Stage 1') || raw.includes('Classification')) {
    return 'Understanding whether this search targets job seekers or job upgraders';
  }
  if (raw.includes('Stage 2') || raw.includes('Sourcing individual')) {
    return 'Searching LinkedIn for matching profiles';
  }
  if (raw.startsWith('[SUCCESS] Classification')) {
    return 'Lead type identified successfully';
  }
  if (raw.startsWith('[INFO] Lead type:')) {
    return `Classified as ${raw.replace('[INFO] Lead type: ', '')}`;
  }
  if (raw.startsWith('[INFO] LLM Confidence:')) {
    return `AI confidence: ${raw.replace('[INFO] LLM Confidence: ', '')}`;
  }
  if (raw.startsWith('[INFO] Claude Reasoning:')) {
    return `Reasoning: ${raw.replace('[INFO] Claude Reasoning: ', '')}`;
  }
  if (raw.startsWith('[LOG] Scraper job created:')) {
    return 'Scraper job queued — preparing to collect profiles';
  }
  if (raw.startsWith('[LOG] Listening to SSE')) {
    return 'Connected to live progress stream';
  }
  if (raw.startsWith('[LOG] Submitting scrape')) {
    return 'Sending search request to the sourcing engine';
  }
  if (raw.startsWith('[SUCCESS] Scraper pipeline finished')) {
    return 'LinkedIn sourcing finished';
  }
  if (raw.startsWith('[LOG] Synced & imported')) {
    const match = raw.match(/(\d+) individual leads/);
    return match ? `Imported ${match[1]} profiles into your drafts` : 'Imported new profiles into your drafts';
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
    return `Now running: ${raw.replace('→ Pipeline Step Start: ', '')}`;
  }
  if (raw.startsWith('✓ Pipeline Step Done:')) {
    return `Completed: ${raw.replace('✓ Pipeline Step Done: ', '').replace(/\s*\(\d+s\)$/, '')}`;
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
