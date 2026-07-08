const KPI_ITEMS = [
  { key: 'totalLeads', label: 'Total leads', fromSummary: true },
  { key: 'search', label: 'Searches' },
  { key: 'company', label: 'Companies' },
  { key: 'location', label: 'Locations' },
  { key: 'title', label: 'Roles' },
  { key: 'newThisWeek', label: 'New this week', fromSummary: true },
];

export default function DashboardKpiStrip({ summary = {}, groupCounts = {} }) {
  return (
    <section className="dash-kpi-row" aria-label="Key metrics">
      {KPI_ITEMS.map((item) => {
        const value = item.fromSummary
          ? (summary[item.key] ?? 0)
          : (groupCounts[item.key] ?? 0);

        return (
          <div key={item.key} className="dash-kpi-card">
            <span className="dash-kpi-value">{Number(value).toLocaleString()}</span>
            <span className="dash-kpi-label">{item.label}</span>
          </div>
        );
      })}
    </section>
  );
}
