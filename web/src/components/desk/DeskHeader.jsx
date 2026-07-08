import { Link } from 'react-router-dom';
import { ROUTES } from '../../lib/desk-routes.js';

export default function DeskHeader({ onNewSearch }) {
  return (
    <header className="desk-toolbar shrink-0">
      <div className="desk-toolbar-row">
        <Link to={ROUTES.dashboard} className="flex shrink-0 items-center gap-2.5 no-underline">
          <div className="desk-brand-mark">L</div>
          <span className="desk-brand-name hidden sm:block">LeadScout</span>
        </Link>

        <div className="flex-1" />

        <button type="button" onClick={onNewSearch} className="desk-btn desk-btn-primary">
          New search
          <kbd className="desk-kbd hidden lg:inline">⌘K</kbd>
        </button>
      </div>
    </header>
  );
}
