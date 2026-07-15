'use client';

import { useEffect, useState } from 'react';

const sessionStarted = process.env.NEXT_PUBLIC_APP_SESSION_STARTED || '';
const sessionMode = process.env.NEXT_PUBLIC_APP_SESSION_MODE || '';
const sessionPort = process.env.NEXT_PUBLIC_APP_SESSION_PORT || '3000';

function formatTime(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

export default function DevModeBanner() {
  const [startedAt, setStartedAt] = useState('');

  useEffect(() => {
    if (sessionStarted) {
      setStartedAt(formatTime(sessionStarted));
    }
  }, []);

  if (!sessionStarted) return null;

  const isDev = sessionMode === 'development';
  const label = isDev ? 'Live dev' : 'Production preview';

  return (
    <div className={`app-session-banner app-session-banner--${isDev ? 'dev' : 'prod'}`} role="status" aria-live="polite">
      <span className="app-session-banner__dot" aria-hidden="true" />
      <span className="app-session-banner__text">
        {label}
        {startedAt ? ` · started ${startedAt}` : ''}
        {' · '}
        <strong>localhost:{sessionPort}</strong>
      </span>
      {isDev && (
        <span className="app-session-banner__hint">Changes hot-reload on save</span>
      )}
    </div>
  );
}
