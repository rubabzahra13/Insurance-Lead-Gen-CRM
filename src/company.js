import { normalizePersonName } from './utils.js';

const COMPANY_SUFFIX_RE = /\b(inc|llc|ltd|corp|co|gmbh|plc)\.?$/i;
const JOB_TITLE_WORDS = new Set([
  'ceo',
  'cto',
  'cfo',
  'coo',
  'founder',
  'co-founder',
  'president',
  'chairman',
  'director',
  'manager',
  'engineer',
  'chief',
]);

export function parseLinkedInTitle(title) {
  if (!title?.trim()) return { name: null, title: null, company: null };

  const cleaned = title.replace(/\s*\|.*$/, '').trim();

  const atSymbol = cleaned.match(/^(.+?)\s*-\s*(.+?)\s+@\s+(.+)$/);
  if (atSymbol) {
    return {
      name: atSymbol[1].trim(),
      title: atSymbol[2].trim(),
      company: atSymbol[3].trim(),
    };
  }

  const atWord = cleaned.match(/^(.+?)\s*-\s*(.+?)\s+at\s+(.+)$/i);
  if (atWord) {
    return {
      name: atWord[1].trim(),
      title: atWord[2].trim(),
      company: atWord[3].trim(),
    };
  }

  const parts = cleaned.split(' - ').map((part) => part.trim()).filter(Boolean);

  // "Name - Founder & CEO, SmarterX & Marketing AI Institute"
  if (parts.length === 2) {
    const roleCompany = parts[1].match(/^(.+?),\s*(.+)$/);
    if (roleCompany) {
      return {
        name: parts[0],
        title: roleCompany[1].trim(),
        company: roleCompany[2].trim(),
      };
    }
  }

  return {
    name: parts[0] ?? null,
    title: parts[1] ?? null,
    company: parts[2] ?? null,
  };
}

const COMPANY_TAIL_RE =
  /\s+(?:joined|to discuss|who|which|where|when|said|spoke|appeared|featured|hosted|and co-host|&)\b.*$/i;

const PODCAST_SNIPPET_RE =
  /\b(?:friend of the show|joined us|podcast|episode|listen to|tune in)\b/i;

function cleanCompanyCandidate(value) {
  if (!value) return null;
  let company = value
    .replace(/\s*\|.*$/, '')
    .replace(/\s+on\s+LinkedIn.*$/i, '')
    .replace(/\s+\d+\+?\s*connections?.*$/i, '')
    .replace(COMPANY_TAIL_RE, '')
    .trim();

  company = company.replace(/[.,;]+$/, '').trim();
  if (company.length < 2 || company.length > 80) return null;
  if (JOB_TITLE_WORDS.has(company.toLowerCase())) return null;
  return company;
}

function splitMultipleCompanies(company) {
  if (!company) return [];
  return company
    .split(/\s*(?:&| and )\s*/i)
    .map((part) => cleanCompanyCandidate(part))
    .filter(Boolean);
}

export function companyLooksLikePersonName(personName, company) {
  if (!personName || !company) return false;

  const nameTokens = normalizePersonName(personName).split(' ').filter((t) => t.length > 1);
  const companyNorm = normalizePersonName(company);

  if (nameTokens.length === 0) return false;

  const lastName = nameTokens[nameTokens.length - 1];
  if (companyNorm === lastName || companyNorm === normalizePersonName(personName)) {
    return true;
  }

  if (nameTokens.length >= 2 && companyNorm === nameTokens.join(' ')) {
    return true;
  }

  return false;
}

export function companyAppearsInText(company, text) {
  if (!company || !text) return false;
  const haystack = text.toLowerCase();
  const needle = company.toLowerCase();
  if (haystack.includes(needle)) return true;

  const stripped = company.replace(COMPANY_SUFFIX_RE, '').trim().toLowerCase();
  return stripped.length >= 3 && haystack.includes(stripped);
}

export function extractCompanyFromText(text, personName) {
  if (!text?.trim()) return null;

  const candidates = [];

  const patterns = [
    /\b(?:founder and CEO|co-?founder and CEO|CEO and founder)\s+(?:of|@)\s+([A-Z][^.,|;\n]{1,80}?)(?=\s+(?:joined|to|and|where|who|,|\.|\||;)|$)/gi,
    /\b(?:CEO|CTO|CFO|COO|founder|co-?founder|president|chairman|chief [\w ]+ officer)\s+(?:of|@)\s+([A-Z][^.,|;\n]{1,80}?)(?=\s+(?:joined|to|and|where|who|,|\.|\||;)|$)/gi,
    /\b(?:serves? as|works? as|is (?:the )?)\w[\w ]{0,30}\s+at\s+([A-Z][^.,|;\n]{1,80}?)(?=\s+(?:joined|to|and|where|who|,|\.|\||;)|$)/gi,
    /\b–\s*([^–\n]+?)\.\s*Recent Transaction/gi,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      for (const part of splitMultipleCompanies(match[1])) {
        candidates.push(part);
      }
    }
  }

  const titleParsed = parseLinkedInTitle(text);
  if (titleParsed.company) {
    candidates.push(cleanCompanyCandidate(titleParsed.company));
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (companyLooksLikePersonName(personName, candidate)) continue;
    if (companyAppearsInText(candidate, text)) return candidate;
  }

  return null;
}

export function buildCompanySourceText(lead) {
  return [lead.source, lead.snippet, lead.evidence, lead.searchResultTitle]
    .filter(Boolean)
    .join('\n');
}

function sourceLooksLikePodcast(text) {
  return PODCAST_SNIPPET_RE.test(text ?? '');
}

export function refineCompanyFromSources(lead) {
  const sourceText = buildCompanySourceText(lead);
  const titleParsed = lead.searchResultTitle
    ? parseLinkedInTitle(lead.searchResultTitle)
    : { company: null };
  const fromTitle = titleParsed.company;
  const titleCompanies = splitMultipleCompanies(fromTitle);
  const snippetIsPodcast = sourceLooksLikePodcast(lead.snippet);

  const fromEvidence = snippetIsPodcast ? null : extractCompanyFromText(sourceText, lead.name);

  const candidates = [];
  for (const company of titleCompanies) {
    candidates.push({ company, source: 'linkedin_title' });
  }
  if (fromTitle && titleCompanies.length === 0) {
    candidates.push({ company: fromTitle, source: 'linkedin_title' });
  }
  if (fromEvidence) {
    candidates.push({ company: fromEvidence, source: 'pattern_match' });
  }
  if (!snippetIsPodcast) {
    candidates.push({ company: lead.company, source: 'llm_json' });
  }

  for (const { company, source } of candidates) {
    const cleaned = cleanCompanyCandidate(company);
    if (!cleaned) continue;
    if (companyLooksLikePersonName(lead.name, cleaned)) continue;
    if (!companyAppearsInText(cleaned, sourceText) && source === 'llm_json') continue;

    return {
      ...lead,
      company: cleaned,
      companySource: source,
    };
  }

  return {
    ...lead,
    company: null,
    companySource: null,
  };
}

export function refineCompaniesFromSources(leads) {
  return leads.map(refineCompanyFromSources);
}
