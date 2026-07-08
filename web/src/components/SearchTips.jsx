export default function SearchTips() {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-sm font-medium text-fg">Describe who you want to find</p>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Role, industry, company type, or location — plain language works best.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {[
          'VP Sales at B2B SaaS',
          'Founders of AI startups in NYC',
          'CMOs at consumer brands',
        ].map((ex) => (
          <span
            key={ex}
            className="rounded-lg border border-border bg-panel px-2.5 py-1 text-xs text-fg-secondary"
          >
            {ex}
          </span>
        ))}
      </div>
    </div>
  );
}
