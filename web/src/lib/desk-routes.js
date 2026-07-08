export const ROUTES = {
  dashboard: '/',
  leads: '/leads',
  leadsNew: '/leads/new',
  leadsStarred: '/leads/starred',
  leadsReview: '/leads/review',
};

export const VIEW_ROUTES = {
  all: ROUTES.leads,
  new: ROUTES.leadsNew,
  starred: ROUTES.leadsStarred,
  review: ROUTES.leadsReview,
};

export function viewFromPath(pathname) {
  if (pathname === ROUTES.leadsReview) return 'review';
  if (pathname === ROUTES.leadsStarred) return 'starred';
  if (pathname === ROUTES.leadsNew) return 'new';
  if (pathname === ROUTES.leads || pathname.startsWith('/leads')) return 'all';
  return null;
}

export function isLeadsRoute(pathname) {
  return pathname.startsWith('/leads');
}

/** Workspace nav highlight — one workspace tab per route. */
export function isWorkspaceNavActive(item, pathname) {
  if (item.end) return pathname === item.to;
  if (item.view === 'all') return pathname === ROUTES.leads;
  if (item.view === 'new') return pathname === ROUTES.leadsNew;
  if (item.view === 'starred') return pathname === ROUTES.leadsStarred;
  if (item.view === 'review') return pathname === ROUTES.leadsReview;
  return pathname === item.to;
}

/** Recent search highlight — independent of workspace; active when that search filter is applied. */
export function isSearchNavActive(view, runId, searchRunId) {
  return view === 'all' && Boolean(runId) && runId === searchRunId;
}
