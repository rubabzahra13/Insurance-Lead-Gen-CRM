import { aggregateRoleGroups } from './role-groups.js';

function rollupTopN(rows, limit = 10) {
  if (rows.length <= limit) return rows;
  const top = rows.slice(0, limit);
  const otherCount = rows.slice(limit).reduce((sum, row) => sum + row.count, 0);
  if (otherCount > 0) top.push({ value: 'Other', count: otherCount });
  return top;
}

function shortPrompt(prompt, max = 40) {
  if (!prompt) return 'Untitled search';
  const trimmed = prompt.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function buildFallbackAnalytics({ stats, recentRuns, facets, since = 'all' }) {
  const s = stats ?? {};
  const titles = facets?.titles ?? [];
  return {
    since,
    summary: {
      totalLeads: s.totalLeads ?? 0,
      newThisWeek: s.newThisWeek ?? 0,
      starredCount: s.starredCount ?? 0,
      pendingDuplicates: s.pendingDuplicates ?? 0,
      totalRuns: s.totalRuns ?? 0,
      multiSearchLeads: 0,
      singleSearchLeads: 0,
    },
    groupCounts: {
      search: recentRuns?.length ?? 0,
      company: facets?.companies?.length ?? 0,
      location: facets?.locations?.length ?? 0,
      title: facets?.titles?.length ?? 0,
      tag: facets?.tags?.length ?? 0,
    },
    overTime: [],
    byMonth: [],
    bySearch: (recentRuns ?? []).map((run) => ({
      value: run.searchPrompt,
      label: shortPrompt(run.searchPrompt),
      count: run.leadsAdded ?? 0,
    })),
    byCompany: rollupTopN(facets?.companies ?? []),
    byLocation: rollupTopN(facets?.locations ?? []),
    byTitle: rollupTopN(titles, 8),
    byRoleGroup: aggregateRoleGroups(titles).filter((r) => r.count > 0),
    byTag: facets?.tags ?? [],
    byStarred: [],
    bySearchOverlap: [],
    recentLeads: [],
    fallback: true,
  };
}
