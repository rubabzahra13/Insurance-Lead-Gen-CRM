import { parseLinkedInTitle } from './company.js';
import { normalizeProfileUrl } from './utils.js';

const ROLE_RE =
  /\b(?:co-?founder(?:\s*&?\s*(?:ceo|cto))?|founder(?:\s*&?\s*(?:ceo|cto))?|ceo|cto|chief executive officer|chief technology officer)\b/i;

// Words that mark a phrase as a job title rather than an employer name. A
// LinkedIn headline is a role by default, so this is the guard that keeps roles
// out of the Company field.
const JOB_TITLE_RE =
  /\b(aspiring|seeking|student|intern|graduate|advisor|adviser|consultant|planner|analyst|associate|assistant|representative|specialist|manager|director|officer|engineer|developer|designer|coordinator|supervisor|agent|broker|underwriter|adjuster|producer|recruiter|major|candidate|professional|entry.?level|junior|senior|trainee|apprentice)\b/i;

const PLACE_RE =
  /\b(?:area|region|metropolitan|united states|united kingdom)\b|(?:,\s*[A-Za-z .'-]{2,30}){1,3}$/i;

function cleanCompany(value) {
  return value?.replace(/\s*\|.*$/, '').replace(/\s*\(YC[^)]*\)/i, '').trim() || null;
}

function looksLikePlace(text) {
  if (!text?.trim()) return false;
  if (ROLE_RE.test(text) && !PLACE_RE.test(text)) return false;
  return PLACE_RE.test(text) || /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}$/.test(text.trim());
}

function inferFounderTitle(searchPrompt, existingTitle, company) {
  if (existingTitle) return existingTitle;
  if (!company || !/\bfounders?\b/i.test(searchPrompt ?? '')) return null;
  return 'Founder';
}

function inferLocationFromContext(searchPrompt, headline, company) {
  const query = (searchPrompt ?? '').toLowerCase();
  const text = `${headline ?? ''} ${company ?? ''}`.toLowerCase();

  const rules = [
    { needle: 'new york', label: 'New York City', alt: ['new york', 'nyc'] },
    { needle: 'san francisco', label: 'San Francisco Bay Area', alt: ['san francisco', 'bay area'] },
    { needle: 'los angeles', label: 'Los Angeles', alt: ['los angeles'] },
    { needle: 'austin', label: 'Austin', alt: ['austin'] },
    { needle: 'boston', label: 'Boston', alt: ['boston'] },
  ];

  for (const rule of rules) {
    if (!query.includes(rule.needle)) continue;
    if (rule.alt.some((token) => text.includes(token))) return rule.label;
  }

  return null;
}

export function parseHeadlineFields(headline) {
  if (!headline?.trim()) return { title: null, company: null, location: null };

  const cleaned = headline.replace(/\s*\|.*$/, '').trim();
  const parsed = parseLinkedInTitle(headline);
  let title = parsed.title?.trim() || null;
  let company = parsed.company?.trim() || null;

  const founderAt = cleaned.match(/\b((?:Co-)?Founder(?:\s*&?\s*(?:CEO|CTO))?)\s*@\s*([^,@|]+)/i);
  if (founderAt) {
    title = title || founderAt[1].trim();
    company = company || cleanCompany(founderAt[2]);
  }

  const roleComma = cleaned.match(
    /\b((?:Co-)?Founder(?:\s*&?\s*(?:CEO|CTO))?|CEO(?:\s*&?\s*CTO)?|CTO)\s*,\s*(.+)$/i,
  );
  if (roleComma) {
    title = title || roleComma[1].trim();
    company = company || cleanCompany(roleComma[2]);
  }

  const atCompany = cleaned.match(/\b((?:Co-)?Founder(?:\s*and\s*CEO)?|CEO(?:\s*&?\s*CTO)?|CTO)\s+at\s+(.+?)(?:\s*\||$)/i);
  if (atCompany) {
    title = title || atCompany[1].trim();
    company = company || cleanCompany(atCompany[2]);
  }

  const stealth = cleaned.match(/\b(Stealth AI Startup)\b/i);
  if (stealth) company = company || stealth[1];

  const profLoc = cleaned.match(/^[^-]+\-\s(.+?)\s\|\s*Professional Profile/i);
  let location = null;
  if (profLoc && looksLikePlace(profLoc[1])) location = profLoc[1].trim();

  const parts = cleaned.split(' - ').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 2) {
    const second = parts[1];
    // A Google result title is "Name - Headline", and a headline is a ROLE. Only
    // an explicit employer marker ("at", "@", ",") above makes it a company, so a
    // job title here must not be promoted to one — that is how "Aspiring
    // Financial Advisor" ended up in the CRM's Company column.
    if (JOB_TITLE_RE.test(second)) {
      title = title || second;
    } else if (!company && !ROLE_RE.test(second) && /[A-Za-z]/.test(second)) {
      company = cleanCompany(second);
    }
    if (!title && ROLE_RE.test(second)) title = second.match(ROLE_RE)?.[0] ?? null;
  }

  if (parts.length >= 3 && !company) {
    company = cleanCompany(parts[parts.length - 1]);
  }

  return { title, company, location };
}

export function findRawItemForLead(rawItems, link, name) {
  if (link) {
    const normalized = normalizeProfileUrl(link);
    const byLink = rawItems.find((item) => normalizeProfileUrl(item.url) === normalized);
    if (byLink) return byLink;
  }

  if (!name?.trim()) return null;
  const lower = name.trim().toLowerCase();
  return (
    rawItems.find((item) => (item.title ?? '').toLowerCase().startsWith(`${lower} -`)) ?? null
  );
}

export function enrichLeadFromRawItem(lead, rawItems, searchPrompt) {
  const item = findRawItemForLead(rawItems, lead.link, lead.name);
  if (!item?.title) return lead;

  const fromHeadline = parseHeadlineFields(item.title);
  const company = lead.company || fromHeadline.company;
  const title =
    lead.title ||
    fromHeadline.title ||
    inferFounderTitle(searchPrompt, null, company);
  const location =
    lead.location ||
    fromHeadline.location ||
    inferLocationFromContext(searchPrompt, item.title, company);

  return { ...lead, title, company, location };
}
