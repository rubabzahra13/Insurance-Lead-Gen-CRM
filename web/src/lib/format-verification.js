const FRIENDLY = {
  has_name: 'Name matched the search results',
  has_title: 'Job title matched the search results',
  has_company: 'Company matched the search results',
  has_location: 'Location was listed in the results',
  has_snippet: 'We found a short profile summary',
  has_link: 'A LinkedIn profile link was found',
  structured: 'Profile details were organized from the search results',
  link_from_grounding: 'LinkedIn link came from Google — not guessed by AI',
  link_from_research: 'LinkedIn link appeared directly in the search results',
  link_from_resolver: 'LinkedIn link was suggested by AI — worth double-checking',
  slug_name_mismatch: 'The profile URL does not seem to match this name',
  url_verified: 'We opened the link and confirmed it shows this person',
  url_inconclusive: 'We could not verify the link — LinkedIn blocked the check',
  url_verify_skipped: 'The link has not been opened to verify yet',
  url_invalid: 'The link may be broken or belong to someone else',
  duplicate_link_collision: 'This link is already used for another lead',
  suspicious_slug_pattern: 'The profile URL looks auto-generated — review carefully',
  missing_link: 'No LinkedIn link was found',
  'name found in results': 'Name matched the search results',
  'title found in results': 'Job title matched the search results',
  'company found in results': 'Company matched the search results',
  'location stated in results': 'Location was listed in the results',
  'description from results': 'We found a short profile summary',
  'has LinkedIn link': 'A LinkedIn profile link was found',
  'fields read and structured by LLM from search results':
    'Profile details were organized from the search results',
  'link taken from Google search index (cannot be made up)':
    'LinkedIn link came from Google — not guessed by AI',
  'link taken from Google sear': 'LinkedIn link came from Google — not guessed by AI',
  'link seen directly in search results': 'LinkedIn link appeared directly in the search results',
  'link written by AI (could be wrong)': 'LinkedIn link was suggested by AI — worth double-checking',
  'WARNING: URL does not match name': 'The profile URL does not seem to match this name',
  'link checked: page loaded and shows this name':
    'We opened the link and confirmed it shows this person',
  'link check blocked by LinkedIn (unconfirmed)':
    'We could not verify the link — LinkedIn blocked the check',
  'link NOT checked': 'The link has not been opened to verify yet',
  'WARNING: link is dead or shows a different person':
    'The link may be broken or belong to someone else',
  'WARNING: same link given to another person': 'This link is already used for another lead',
  'WARNING: URL ending looks auto-generated': 'The profile URL looks auto-generated — review carefully',
  'no LinkedIn link found': 'No LinkedIn link was found',
};

function friendlySlugMatch(line) {
  const match = line.match(/^URL matches name \((\d+)%\)$/i);
  if (!match) return null;
  return `profile url looks about ${match[1]}% likely to belong to them`;
}

function friendlyLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const slug = friendlySlugMatch(trimmed);
  if (slug) return slug;

  if (FRIENDLY[trimmed]) return FRIENDLY[trimmed];

  if (trimmed.startsWith('WARNING:')) {
    return trimmed.replace(/^WARNING:\s*/i, '').replace(/^./, (c) => c.toUpperCase());
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function hasLine(lines, pattern) {
  return lines.some((line) => pattern.test(line));
}

function joinList(items) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

function sentence(text) {
  const trimmed = text.trim().replace(/\.$/, '');
  if (!trimmed) return '';
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.`;
}

function summarizeLines(lines) {
  const sentences = [];

  const matched = [];
  if (hasLine(lines, /name matched/i)) matched.push('name');
  if (hasLine(lines, /job title matched/i)) matched.push('job title');
  if (hasLine(lines, /company matched/i)) matched.push('company');
  if (hasLine(lines, /location was listed/i)) matched.push('location');

  if (matched.length) {
    sentences.push(`This person's ${joinList(matched)} matched the search results`);
  }

  if (hasLine(lines, /profile summary/i)) {
    sentences.push('We also found a short profile summary');
  }

  if (hasLine(lines, /Google — not guessed/i)) {
    sentences.push('The LinkedIn link came from Google, not from AI guessing');
  } else if (hasLine(lines, /appeared directly in the search/i)) {
    sentences.push('The LinkedIn link appeared directly in the search results');
  } else if (hasLine(lines, /suggested by AI/i)) {
    sentences.push('The LinkedIn link was suggested by AI, so it is worth double-checking');
  } else if (hasLine(lines, /LinkedIn profile link was found/i)) {
    sentences.push('A LinkedIn profile link was found');
  }

  if (hasLine(lines, /organized from the search results/i)) {
    sentences.push('We organized the profile details from those search results');
  }

  const slugLine = lines.find((line) => /profile url looks about/i.test(line));
  if (slugLine) {
    sentences.push(slugLine.charAt(0).toUpperCase() + slugLine.slice(1));
  }

  if (hasLine(lines, /opened the link and confirmed/i)) {
    sentences.push('We opened the link and confirmed it shows this person');
  } else if (hasLine(lines, /could not verify the link/i)) {
    sentences.push('We could not verify the link because LinkedIn blocked the check');
  } else if (hasLine(lines, /has not been opened to verify/i)) {
    sentences.push('The link has not been opened to verify yet');
  }

  const warnings = lines.filter((line) =>
    /does not seem to match|may be broken|already used for another|auto-generated|review carefully/i.test(
      line,
    ),
  );
  for (const warning of warnings) {
    sentences.push(warning);
  }

  if (hasLine(lines, /No LinkedIn link was found/i)) {
    sentences.push('No LinkedIn link was found');
  }

  const covered = new Set(sentences.map((s) => s.toLowerCase()));
  for (const line of lines) {
    const lower = line.toLowerCase();
    const alreadyUsed = [...covered].some(
      (s) => s.includes(lower.slice(0, 20)) || lower.includes(s.slice(0, 20)),
    );
    if (!alreadyUsed) sentences.push(line);
  }

  return sentences.map(sentence).join(' ');
}

export function formatVerificationNotes(notes) {
  if (!notes?.trim()) return '';

  const lines = notes
    .split(';')
    .map(friendlyLine)
    .filter(Boolean);

  return summarizeLines(lines);
}
