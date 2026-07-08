import { leadMatchesDeskFilters } from './lead-filters.js';

export function pipelineLeadToDeskLead(lead, { runId, searchPrompt } = {}) {
  const now = new Date().toISOString();
  return {
    id: lead.id ?? `preview-${lead.link ?? lead.name}`,
    name: lead.name ?? '',
    title: lead.title ?? null,
    company: lead.company ?? null,
    location: lead.location ?? null,
    link: lead.link ?? null,
    linkSlug: lead.linkSlug ?? null,
    linkSource: lead.linkSource ?? null,
    snippet: lead.snippet ?? null,
    evidence: lead.evidence ?? null,
    confidence: lead.confidence ?? null,
    status: lead.status ?? null,
    verificationNotes: lead.verificationNotes ?? null,
    searchPrompt: lead.searchPrompt ?? searchPrompt ?? null,
    scrapedAt: lead.scrapedAt ?? now,
    starred: Boolean(lead.starred),
    tags: lead.tags ?? [],
    notes: lead.notes ?? null,
    urlVerification: lead.urlVerification ?? null,
    source: lead.source ?? null,
    createdAt: lead.createdAt ?? now,
    updatedAt: lead.updatedAt ?? now,
    _preview: true,
    _runId: runId ?? null,
    _runIds: runId ? [runId] : [],
  };
}

export function filterPipelineLeadsForDesk(leads, deskState) {
  const { view, filters, runId } = deskState;
  return leads
    .map((lead) => pipelineLeadToDeskLead(lead, { runId, searchPrompt: deskState.searchPrompt }))
    .filter((lead) => leadMatchesDeskFilters(lead, { view, filters, runId }));
}
