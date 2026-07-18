'use client';

import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronsUpDown, Search, X } from 'lucide-react';

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function optionMatchesQuery(option, query) {
  const q = normalizeSearchText(query);
  if (!q) return true;
  const haystack = normalizeSearchText(option);
  // Every token must appear (so "soft eng" matches "Software Engineer").
  return q.split(' ').every((token) => token && haystack.includes(token));
}

/**
 * Compact searchable single-select for long filter option lists.
 */
export default function SearchableFilterSelect({
  label,
  value,
  options = [],
  recentOptions = [],
  allLabel = 'All',
  allValue = 'all',
  searchPlaceholder = 'Search…',
  emptyLabel = 'No matches',
  onChange,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [panelStyle, setPanelStyle] = useState(null);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const inputRef = useRef(null);
  const listId = useId();
  const searching = Boolean(query.trim());

  const selectedLabel = value === allValue
    ? allLabel
    : (options.find((opt) => opt === value) || value || allLabel);

  const uniqueOptions = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const opt of options) {
      const text = String(opt || '').trim();
      if (!text || text === allValue) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(text);
    }
    return list;
  }, [options, allValue]);

  const uniqueRecent = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const opt of recentOptions) {
      const text = String(opt || '').trim();
      if (!text || text === allValue) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      list.push(text);
    }
    return list.slice(0, 5);
  }, [recentOptions, allValue]);

  const recentMatches = useMemo(
    () => uniqueRecent.filter((opt) => optionMatchesQuery(opt, query)),
    [uniqueRecent, query],
  );

  const recentMatchSet = useMemo(
    () => new Set(recentMatches.map((opt) => opt.toLowerCase())),
    [recentMatches],
  );

  const otherMatches = useMemo(
    () => uniqueOptions
      .filter((opt) => !recentMatchSet.has(opt.toLowerCase()))
      .filter((opt) => optionMatchesQuery(opt, query)),
    [uniqueOptions, recentMatchSet, query],
  );

  const matchCount = recentMatches.length + otherMatches.length;

  const updatePanelPosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportPad = 8;
    const minWidth = 240;
    const maxWidth = Math.min(360, window.innerWidth - viewportPad * 2);
    const width = Math.min(maxWidth, Math.max(rect.width, minWidth));
    const estimatedHeight = Math.min(320, 56 + Math.max(matchCount, 1) * 36);
    const spaceBelow = window.innerHeight - rect.bottom - viewportPad;
    const openUp = spaceBelow < estimatedHeight && rect.top > spaceBelow;

    let left = rect.left;
    if (left + width > window.innerWidth - viewportPad) {
      left = Math.max(viewportPad, window.innerWidth - width - viewportPad);
    }
    if (left < viewportPad) left = viewportPad;

    setPanelStyle({
      position: 'fixed',
      left,
      width,
      top: openUp ? undefined : rect.bottom + 6,
      bottom: openUp ? window.innerHeight - rect.top + 6 : undefined,
      maxHeight: Math.min(320, openUp ? rect.top - viewportPad - 6 : spaceBelow),
      zIndex: 80,
    });
  };

  useLayoutEffect(() => {
    if (!open) {
      setPanelStyle(null);
      return undefined;
    }

    updatePanelPosition();

    const onReposition = () => updatePanelPosition();
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);

    return () => {
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open, matchCount]);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event) => {
      const inTrigger = rootRef.current?.contains(event.target);
      const inPanel = panelRef.current?.contains(event.target);
      if (!inTrigger && !inPanel) {
        setOpen(false);
        setQuery('');
      }
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setQuery('');
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(focusTimer);
    };
  }, [open]);

  const choose = (next) => {
    onChange?.(next);
    setOpen(false);
    setQuery('');
  };

  const renderOption = (opt, keyPrefix = '') => (
    <button
      key={`${keyPrefix}${opt}`}
      type="button"
      role="option"
      aria-selected={value === opt}
      className={`searchable-filter__option${value === opt ? ' is-selected' : ''}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => choose(opt)}
    >
      <span title={opt}>{opt}</span>
      {value === opt ? <Check size={14} aria-hidden="true" /> : null}
    </button>
  );

  const panel = open && panelStyle && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={panelRef}
        className="searchable-filter__panel searchable-filter__panel--portal"
        style={panelStyle}
        role="presentation"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="searchable-filter__search">
          <Search size={14} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            placeholder={searchPlaceholder}
            aria-label={`Search ${label}`}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          {searching ? (
            <button
              type="button"
              className="searchable-filter__clear-query"
              aria-label="Clear search"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setQuery('')}
            >
              <X size={12} />
            </button>
          ) : null}
        </div>

        <div className="searchable-filter__list" id={listId} role="listbox" aria-label={label}>
          {!searching && (
            <button
              type="button"
              role="option"
              aria-selected={value === allValue}
              className={`searchable-filter__option${value === allValue ? ' is-selected' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(allValue)}
            >
              <span>{allLabel}</span>
              {value === allValue ? <Check size={14} aria-hidden="true" /> : null}
            </button>
          )}

          {recentMatches.length > 0 && (
            <>
              <div className="searchable-filter__group">
                {searching ? 'Recent matches' : 'Recent'}
              </div>
              {recentMatches.map((opt) => renderOption(opt, 'recent-'))}
            </>
          )}

          {otherMatches.length > 0 && (
            <>
              <div className="searchable-filter__group">
                {searching ? 'Matches' : 'All'}
                <span className="searchable-filter__count">{otherMatches.length}</span>
              </div>
              {otherMatches.map((opt) => renderOption(opt))}
            </>
          )}

          {searching && matchCount === 0 && (
            <p className="searchable-filter__empty">{emptyLabel}</p>
          )}
        </div>
      </div>,
      document.body,
    )
    : null;

  return (
    <div className={`searchable-filter${open ? ' is-open' : ''}${value !== allValue ? ' has-value' : ''}`} ref={rootRef}>
      <span className="searchable-filter__label">{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className="searchable-filter__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="searchable-filter__value" title={selectedLabel}>
          {selectedLabel}
        </span>
        <ChevronsUpDown size={14} aria-hidden="true" />
      </button>
      {panel}
    </div>
  );
}
