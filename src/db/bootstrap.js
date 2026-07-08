import { getDeskSnapshot } from './desk.js';

/** @deprecated Use getDeskSnapshot via /api/desk */
export async function getBootstrapData(params = {}) {
  const snap = await getDeskSnapshot(params);
  return {
    stats: snap.stats,
    recentRuns: snap.recentRuns,
    facets: snap.facets,
    savedViews: snap.savedViews,
    duplicates: snap.duplicates,
    duplicatesTotal: snap.duplicatesTotal,
    leads: snap.leads,
    leadsTotal: snap.leadsTotal,
  };
}
