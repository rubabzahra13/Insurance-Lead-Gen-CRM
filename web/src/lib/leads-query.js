const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function buildLeadsQueryParams({ view, filters, sort, limit, offset }) {
  const params = {
    limit,
    offset,
    q: filters.q || undefined,
    company: filters.company || undefined,
    location: filters.location || undefined,
    title: filters.title || undefined,
    tag: filters.tag || undefined,
    runId: filters.runId || undefined,
  };

  if (sort?.field) params.sort = sort.field;
  if (sort?.order) params.order = sort.order;

  if (view === 'starred') params.starred = '1';
  if (view === 'new') {
    params.createdSince = new Date(Date.now() - WEEK_MS).toISOString();
  }

  return params;
}

export function buildBootstrapParams({ view, filters, sort, limit, offset }) {
  return {
    view,
    ...buildLeadsQueryParams({ view, filters, sort, limit, offset }),
  };
}

export const buildDeskParams = buildBootstrapParams;

export function buildFacetQueryParams({ view, filters }) {
  const { limit: _limit, offset: _offset, ...params } = buildLeadsQueryParams({
    view,
    filters,
    limit: 1,
    offset: 0,
  });
  return params;
}

export function pageRange(page, limit, total) {
  if (total <= 0) return { start: 0, end: 0 };
  return {
    start: (page - 1) * limit + 1,
    end: Math.min(page * limit, total),
  };
}
