export function initials(name) {
  return (
    (name ?? '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase() || '?'
  );
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" className="inspector-icon" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" d="M5 5l10 10M15 5 5 15" />
    </svg>
  );
}

export function StarIcon({ filled }) {
  return (
    <svg viewBox="0 0 20 20" className="inspector-icon" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75">
      <path d="M10 2.5l1.76 3.57 3.94.57-2.85 2.78.67 3.92L10 11.9l-3.52 1.85.67-3.92-2.85-2.78 3.94-.57L10 2.5z" />
    </svg>
  );
}

export function LinkIcon() {
  return (
    <svg viewBox="0 0 20 20" className="inspector-icon" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path strokeLinecap="round" strokeLinejoin="round" d="M11 3h6v6M9 11l8-8M7 7H4.5A1.5 1.5 0 003 8.5v8A1.5 1.5 0 004.5 18h8a1.5 1.5 0 001.5-1.5V15" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" className="inspector-icon" fill="none" stroke="currentColor" strokeWidth="1.75">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 6h11M8 6V4.5h4V6M7 6v8.5h6V6" />
    </svg>
  );
}

export function InspectorStat({ value, label }) {
  return (
    <div className="inspector-stat">
      <span className="inspector-stat-value">{value}</span>
      <span className="inspector-stat-label">{label}</span>
    </div>
  );
}

export function InspectorPill({ children }) {
  return <span className="inspector-pill">{children}</span>;
}

export default function InspectorShell({ title, subtitle, onClose, stat, actions, footer, children }) {
  return (
    <aside className="desk-inspector animate-slide-in-right flex h-full min-h-0 shrink-0 flex-col">
      <header className="inspector-header">
        <div className="inspector-header-top">
          <div className="inspector-avatar" aria-hidden="true">
            {initials(title)}
          </div>
          <div className="inspector-identity">
            <h2 className="inspector-name">{title}</h2>
            {subtitle && <p className="inspector-subtitle">{subtitle}</p>}
          </div>
          {stat}
          <button type="button" onClick={onClose} className="inspector-close" aria-label="Close panel">
            <CloseIcon />
          </button>
        </div>
        {actions && <div className="inspector-actions">{actions}</div>}
      </header>

      <div className="inspector-body desk-scroll">{children}</div>

      {footer && <footer className="inspector-footer">{footer}</footer>}
    </aside>
  );
}
