'use client';

import React, { useEffect, useRef, useState } from 'react';
import { MapPin, Loader2, X, ChevronDown } from 'lucide-react';

/**
 * Search-then-select location control.
 * User must click an option in the dropdown — free text is never kept.
 */
export default function LocationPicker({ value, onChange, invalid = false, required = false }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const selectingRef = useRef(false);
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';

  const selected = Boolean(value?.placeId);
  const showMenu = open && !selected;

  useEffect(() => {
    const onDoc = (e) => {
      if (selectingRef.current) return;
      if (!wrapRef.current?.contains(e.target)) {
        setOpen(false);
        setQuery('');
        setItems([]);
        setError('');
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const fetchSuggestions = async (q) => {
    const text = q.trim();
    if (text.length < 2) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(
        `${apiBaseUrl}/api/places/autocomplete?q=${encodeURIComponent(text)}`,
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.detail === 'string' ? data.detail : 'Could not load locations');
        setItems([]);
        return;
      }
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch {
      setError('Could not load locations');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const handleQueryChange = (e) => {
    const next = e.target.value;
    setQuery(next);
    setError('');
    setOpen(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(next), 250);
  };

  const clearSelection = () => {
    onChange(null);
    setQuery('');
    setItems([]);
    setOpen(true);
    setError('');
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const selectItem = async (item) => {
    if (!item?.placeId) return;
    selectingRef.current = true;
    setOpen(false);
    setItems([]);
    setQuery('');

    const displayLabel = item.label || item.mainText || '';
    const base = {
      placeId: item.placeId,
      label: displayLabel,
      mainText: item.mainText,
      secondaryText: item.secondaryText,
      types: item.types,
    };
    onChange(base);

    try {
      const res = await fetch(
        `${apiBaseUrl}/api/places/details?placeId=${encodeURIComponent(item.placeId)}`,
      );
      const details = await res.json().catch(() => ({}));
      if (res.ok && details.placeId) {
        onChange({
          ...base,
          city: details.city,
          region: details.region,
          country: details.country,
          countryCode: details.countryCode,
          scope: details.scope,
          types: details.types || item.types,
          formattedAddress: details.formattedAddress,
        });
      }
    } catch {
      // Keep selection as-is.
    } finally {
      selectingRef.current = false;
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
      setItems([]);
      return;
    }
    if (e.key === 'Enter') {
      // Never accept free text — only a list choice.
      e.preventDefault();
      if (items.length === 1) selectItem(items[0]);
      else setOpen(true);
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      if (query.trim().length >= 2) fetchSuggestions(query);
    }
  };

  const openPicker = () => {
    if (selected) return;
    setOpen(true);
    inputRef.current?.focus();
  };

  return (
    <div className={`location-picker${invalid ? ' location-picker--invalid' : ''}`} ref={wrapRef}>
      <div
        className={`location-picker__field${selected ? ' location-picker__field--selected' : ''}${showMenu ? ' location-picker__field--open' : ''}`}
        onClick={openPicker}
      >
        <MapPin className="location-picker__icon" size={18} aria-hidden="true" />

        {selected ? (
          <>
            <span className="location-picker__value" title={value.label}>
              {value.label}
            </span>
            <button
              type="button"
              className="location-picker__clear"
              onClick={(e) => {
                e.stopPropagation();
                clearSelection();
              }}
              aria-label="Clear location"
            >
              <X size={14} />
            </button>
          </>
        ) : (
          <input
            ref={inputRef}
            id="lead-location-input"
            type="text"
            className="location-picker__input"
            placeholder="Select a location"
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setOpen(true)}
            aria-label="Location (required) — select from the list"
            aria-required={required || undefined}
            aria-autocomplete="list"
            aria-expanded={showMenu}
            aria-controls="location-picker-listbox"
            autoComplete="off"
            role="combobox"
          />
        )}

        {loading && <Loader2 className="location-picker__spinner animate-spin" size={16} />}
        {!loading && !selected && (
          <ChevronDown
            className={`location-picker__chevron${showMenu ? ' location-picker__chevron--open' : ''}`}
            size={16}
            aria-hidden="true"
          />
        )}
      </div>

      {error && <p className="location-picker__error">{error}</p>}

      {showMenu && (
        <div className="location-picker__dropdown" id="location-picker-listbox">
          <div className="location-picker__menu-header">
            Select one option from the list
          </div>

          {loading && (
            <div className="location-picker__empty" role="status">
              Searching locations…
            </div>
          )}

          {!loading && query.trim().length < 2 && (
            <div className="location-picker__empty" role="status">
              Type to search, then click a result
            </div>
          )}

          {!loading && query.trim().length >= 2 && items.length === 0 && !error && (
            <div className="location-picker__empty" role="status">
              No matches. Try another city or country
            </div>
          )}

          {!loading && items.length > 0 && (
            <ul className="location-picker__menu" role="listbox">
              {items.map((item) => (
                <li key={item.placeId} role="option">
                  <button
                    type="button"
                    className="location-picker__option"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectingRef.current = true;
                    }}
                    onClick={() => selectItem(item)}
                  >
                    <span className="location-picker__option-text">
                      <span className="location-picker__option-main">{item.mainText || item.label}</span>
                      {item.secondaryText && (
                        <span className="location-picker__option-sub">{item.secondaryText}</span>
                      )}
                    </span>
                    <span className="location-picker__option-action">Select</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
