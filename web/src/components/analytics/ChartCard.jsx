export default function ChartCard({ title, subtitle, action, children, className = '', tall }) {
  return (
    <section className={`analytics-card${tall ? ' analytics-card-tall' : ''} ${className}`.trim()}>
      <header className="analytics-card-head">
        <div>
          <h2 className="analytics-card-title">{title}</h2>
          {subtitle && <p className="analytics-card-subtitle">{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className="analytics-card-body">{children}</div>
    </section>
  );
}
