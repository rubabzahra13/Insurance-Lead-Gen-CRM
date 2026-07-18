import { slugMatchesName } from './utils.js';

export function scoreLeadConfidence(lead, context = {}) {
  const reasons = [];
  let score = 0;

  if (lead.name) {
    score += 0.12;
    reasons.push('has_name');
  }

  if (lead.title) {
    score += 0.12;
    reasons.push('has_title');
  }

  if (lead.company) {
    score += 0.12;
    reasons.push('has_company');
  }

  if (lead.location) {
    score += 0.04;
    reasons.push('has_location');
  }

  if (lead.snippet && lead.snippet.length >= 40) {
    score += 0.12;
    reasons.push('has_snippet');
  }

  if (lead.link) {
    score += 0.08;
    reasons.push('has_link');
  }

  if (lead.source === 'llm_structured' && lead.evidence) {
    score += 0.1;
    reasons.push('structured');
  }

  if (lead.linkSource === 'grounding') {
    score += 0.2;
    reasons.push('link_from_grounding');
  }

  if (lead.linkSource === 'structured') {
    score += 0.12;
    reasons.push('link_from_research');
  }

  if (lead.linkSource === 'research') {
    score += 0.1;
    reasons.push('link_from_research');
  }

  if (lead.linkSource === 'resolver') {
    score += 0.05;
    reasons.push('link_from_resolver');
  }

  const slugMatch = slugMatchesName(lead.linkSlug ?? lead.link, lead.name);
  if (slugMatch >= 0.5) {
    score += 0.15 * slugMatch;
    reasons.push(`slug_name_match_${Math.round(slugMatch * 100)}`);
  } else if (lead.link) {
    score -= 0.2;
    reasons.push('slug_name_mismatch');
  }

  if (lead.urlVerification?.status === 'verified') {
    score += 0.25;
    reasons.push('url_verified');
  } else if (lead.urlVerification?.status === 'inconclusive') {
    score += 0.05;
    reasons.push('url_inconclusive');
  } else if (lead.urlVerification?.status === 'skipped') {
    score += 0.02;
    reasons.push('url_verify_skipped');
  } else if (lead.urlVerification?.status === 'invalid') {
    score -= 0.35;
    reasons.push('url_invalid');
  }

  if (context.duplicateLink) {
    score -= 0.4;
    reasons.push('duplicate_link_collision');
  }

  if (context.suspiciousSlug) {
    // LinkedIn often appends numbers to real profile slugs — only nudge, don't kill.
    score -= 0.05;
    reasons.push('suspicious_slug_pattern');
  }

  if (!lead.link) {
    score -= 0.15;
    reasons.push('missing_link');
  }

  const confidence = Math.max(0, Math.min(1, Number(score.toFixed(2))));

  return {
    confidence,
    status: classifyLeadStatus(confidence, lead),
    reasons,
  };
}

function classifyLeadStatus(confidence, lead) {
  const minExport = Number(process.env.MIN_CONFIDENCE ?? 0.55);
  const minVerifiedLink = process.env.REQUIRE_VERIFIED_LINK === 'true';

  if (confidence < minExport) return 'rejected';
  if (minVerifiedLink && lead.link && lead.urlVerification?.status !== 'verified') {
    return 'rejected';
  }
  // "link checked" is reserved for leads whose URL was actually requested and
  // showed the person's name — never awarded on confidence score alone.
  if (lead.urlVerification?.status === 'verified') return 'link checked: name on profile';
  if (lead.linkSource === 'grounding' && confidence >= 0.7) {
    return 'real link from Google index (not live-checked)';
  }
  if (confidence >= 0.75 && lead.link) return 'strong match (link not checked)';
  return 'needs review';
}

const REASON_LABELS = {
  has_name: 'Name matched the search results',
  has_title: 'Job title matched the search results',
  has_company: 'Company matched the search results',
  has_location: 'Location was listed in the results',
  has_snippet: 'We found a short profile summary',
  has_link: 'A LinkedIn profile link was found',
  link_from_grounding: 'LinkedIn link came from Google — not guessed by AI',
  link_from_research: 'LinkedIn link appeared directly in the search results',
  link_from_resolver: 'LinkedIn link was suggested by AI — worth double-checking',
  structured: 'Profile details were organized from the search results',
  slug_name_mismatch: 'The profile URL does not seem to match this name',
  url_verified: 'We opened the link and confirmed it shows this person',
  url_inconclusive: 'We could not verify the link — LinkedIn blocked the check',
  url_verify_skipped: 'The link has not been opened to verify yet',
  url_invalid: 'The link may be broken or belong to someone else',
  duplicate_link_collision: 'This link is already used for another lead',
  suspicious_slug_pattern: 'The profile URL looks auto-generated — review carefully',
  missing_link: 'No LinkedIn link was found',
};

function describeReasons(reasons) {
  return reasons
    .map((reason) => {
      const match = reason.match(/^slug_name_match_(\d+)$/);
      if (match) return `Profile URL looks about ${match[1]}% likely to belong to them`;
      return REASON_LABELS[reason] ?? reason;
    })
    .join('; ');
}

export function annotateLeadConfidence(lead, context = {}) {
  const { confidence, status, reasons } = scoreLeadConfidence(lead, context);
  return {
    ...lead,
    confidence,
    status,
    verificationNotes: describeReasons(reasons),
  };
}
