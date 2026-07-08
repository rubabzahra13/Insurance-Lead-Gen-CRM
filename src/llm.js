import * as claude from './claude.js';
import * as gemini from './gemini.js';

function provider() {
  return (process.env.LLM_PROVIDER ?? 'claude').trim().toLowerCase();
}

function impl() {
  return provider() === 'gemini' ? gemini : claude;
}

export const researchLeads = (...args) => impl().researchLeads(...args);
export const resolveSingleLeadLink = (...args) => impl().resolveSingleLeadLink(...args);
export const resolveLeadLinksInBatches = (...args) => impl().resolveLeadLinksInBatches(...args);
export const resolveLeadLinksIndividually = (...args) => impl().resolveLeadLinksIndividually(...args);
export const resolveLeadLinks = (...args) => impl().resolveLeadLinks(...args);
export const searchLinkedInLeads = (...args) => impl().searchLinkedInLeads(...args);
export const refineCompanyNames = (...args) => impl().refineCompanyNames(...args);
export const expandSearchNotes = (...args) => impl().expandSearchNotes?.(...args);
export const structureLeadsFromRaw = (...args) => impl().structureLeadsFromRaw(...args);

export function activeProvider() {
  return provider();
}
