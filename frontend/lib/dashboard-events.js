export const DASHBOARD_REFRESH_EVENT = 'insurelead:dashboard-refresh';

export function refreshDashboard() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(DASHBOARD_REFRESH_EVENT));
  }
}
