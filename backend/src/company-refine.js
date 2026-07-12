import {
  buildCompanySourceText,
  companyAppearsInText,
  companyLooksLikePersonName,
  refineCompaniesFromSources,
} from './company.js';
import { normalizeLlmResponse } from './llm-response.js';
import { asLeadArray, parseJsonFromText } from './parse-json.js';
import { normalizePersonName } from './utils.js';

export { refineCompaniesFromSources };

function leadNeedsLlmCompanyRefine(lead) {
  if (!lead.company) return true;
  const sourceText = buildCompanySourceText(lead);
  if (companyLooksLikePersonName(lead.name, lead.company)) return true;
  if (!companyAppearsInText(lead.company, sourceText)) return true;
  return lead.companySource === 'llm_json';
}

export function applyCompanyRefinement(leads, response) {
  const { text } = normalizeLlmResponse(response);
  const items = asLeadArray(parseJsonFromText(text));
  const byName = new Map(
    items
      .filter((item) => item?.name)
      .map((item) => [normalizePersonName(item.name), item]),
  );

  return leads.map((lead) => {
    const item = byName.get(normalizePersonName(lead.name));
    if (!item) return lead;

    const sourceText = buildCompanySourceText(lead);
    const company = item.company?.trim() || null;
    const companyEvidence = item.company_evidence?.trim() || null;

    if (!company) {
      return { ...lead, company: null, companySource: 'llm_refine_null' };
    }

    if (companyLooksLikePersonName(lead.name, company)) {
      return lead;
    }

    const evidenceOk =
      companyEvidence &&
      sourceText.toLowerCase().includes(companyEvidence.toLowerCase());
    const companyOk =
      companyAppearsInText(company, sourceText) ||
      (evidenceOk && companyAppearsInText(company, companyEvidence));

    if (!companyOk) {
      return lead;
    }

    return {
      ...lead,
      company,
      evidence: companyEvidence || lead.evidence,
      companySource: 'llm_refine',
    };
  });
}

export async function refineCompanyNames(leads, callTextOnly, promptBuilder) {
  let refined = refineCompaniesFromSources(leads);

  const targets = refined.filter(leadNeedsLlmCompanyRefine);
  const maxTargets = Number(process.env.COMPANY_REFINE_MAX ?? 10);
  if (targets.length === 0 || process.env.COMPANY_REFINE_LLM === 'false') {
    return refined;
  }

  const batch = targets.slice(0, maxTargets);
  const response = await callTextOnly(promptBuilder(batch));
  refined = applyCompanyRefinement(refined, response);

  return refineCompaniesFromSources(refined);
}
