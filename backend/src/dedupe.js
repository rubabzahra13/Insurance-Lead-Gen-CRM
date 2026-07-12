import { linkedinSlugFromUrl, personIdentityKey } from './utils.js';

const SUSPICIOUS_SLUG_RE = /(?:\d{6,}|(?:[a-f0-9]{2,}\d){3,}|88888888|a7a7)/i;

export function dedupeByPerson(leads) {
  const byIdentity = new Map();

  for (const lead of leads) {
    const key = personIdentityKey(lead);
    if (!key || key === '|') continue;

    if (byIdentity.has(key)) {
      byIdentity.set(key, mergePreferRicher(byIdentity.get(key), lead));
    } else {
      byIdentity.set(key, lead);
    }
  }

  return [...byIdentity.values()];
}

function mergePreferRicher(existing, incoming) {
  const score = (lead) =>
    [lead.snippet, lead.title, lead.company, lead.location, lead.link].filter(Boolean).length;

  return score(incoming) > score(existing) ? { ...existing, ...incoming } : { ...incoming, ...existing };
}

export function findLinkCollisions(leads) {
  const byLink = new Map();

  for (const lead of leads) {
    if (!lead.link) continue;
    const group = byLink.get(lead.link) ?? [];
    group.push(lead);
    byLink.set(lead.link, group);
  }

  return [...byLink.values()].filter((group) => group.length > 1);
}

export function findSuspiciousSlugs(leads) {
  const slugOwners = new Map();

  for (const lead of leads) {
    const slug = lead.linkSlug ?? linkedinSlugFromUrl(lead.link);
    if (!slug) continue;

    const owners = slugOwners.get(slug) ?? [];
    owners.push(lead);
    slugOwners.set(slug, owners);
  }

  const suspicious = new Set();

  for (const [slug, owners] of slugOwners.entries()) {
    if (owners.length > 1 || SUSPICIOUS_SLUG_RE.test(slug)) {
      for (const lead of owners) {
        suspicious.add(personIdentityKey(lead));
      }
    }
  }

  return suspicious;
}

export function clearLinksForReResolution(leads, identities) {
  return leads.map((lead) => {
    if (!identities.has(personIdentityKey(lead))) return lead;
    return {
      ...lead,
      link: null,
      linkSlug: null,
      linkSource: null,
      urlVerification: null,
    };
  });
}
