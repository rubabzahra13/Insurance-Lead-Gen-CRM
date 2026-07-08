export default function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="analytics-tooltip">
      {label && <p className="analytics-tooltip-label">{label}</p>}
      {payload.map((entry) => (
        <div key={entry.name ?? entry.dataKey} className="analytics-tooltip-row">
          <span className="analytics-tooltip-dot" style={{ background: entry.color ?? entry.fill }} />
          <span className="analytics-tooltip-name">{entry.name ?? entry.dataKey}</span>
          <span className="analytics-tooltip-value">
            {formatter ? formatter(entry.value, entry) : entry.value?.toLocaleString?.() ?? entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}
