'use client';

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronsUpDown } from 'lucide-react';

/**
 * Compact single-select matching SearchableFilterSelect visuals, without search.
 * Options: [{ value, label }]
 */
export default function MenuSelect({
  value,
  options = [],
  onChange,
  label,
  ariaLabel,
  className = '',
  disabled = false,
  /** Value that should not get the "has-value" accent (e.g. all / newest). */
  neutralValue = 'all',
  /** When set, trigger shows only this icon (no label / chevron). */
  triggerIcon = null,
  iconOnly = false,
}) {
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState(null);
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const listId = useId();

  const selected = options.find((opt) => opt.value === value);
  const selectedLabel = selected?.label || label || 'Select';

  const updatePanelPosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportPad = 8;
    const width = Math.min(
      Math.max(rect.width, iconOnly ? 200 : 168),
      window.innerWidth - viewportPad * 2,
    );
    const estimatedHeight = Math.min(280, 12 + options.length * 36);
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
      maxHeight: Math.min(280, openUp ? rect.top - viewportPad - 6 : spaceBelow),
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
  }, [open, options.length, iconOnly]);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event) => {
      const inTrigger = rootRef.current?.contains(event.target);
      const inPanel = panelRef.current?.contains(event.target);
      if (!inTrigger && !inPanel) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const choose = (next) => {
    if (next !== value) onChange?.(next);
    setOpen(false);
  };

  const panel = open && panelStyle && typeof document !== 'undefined'
    ? createPortal(
      <div
        ref={panelRef}
        className="searchable-filter__panel menu-select__panel"
        style={panelStyle}
        role="presentation"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="searchable-filter__list" id={listId} role="listbox" aria-label={ariaLabel || label || 'Options'}>
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={value === opt.value}
              className={`searchable-filter__option${value === opt.value ? ' is-selected' : ''}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(opt.value)}
            >
              <span title={opt.label}>{opt.label}</span>
              {value === opt.value ? <Check size={14} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      </div>,
      document.body,
    )
    : null;

  return (
    <div
      className={`searchable-filter menu-select${open ? ' is-open' : ''}${value && value !== neutralValue ? ' has-value' : ''}${iconOnly ? ' menu-select--icon-only' : ''}${className ? ` ${className}` : ''}`}
      ref={rootRef}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {label && !iconOnly ? <span className="searchable-filter__label">{label}</span> : null}
      <button
        ref={triggerRef}
        type="button"
        className="searchable-filter__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel || label || 'Select option'}
        title={ariaLabel || selectedLabel}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        {iconOnly && triggerIcon ? (
          triggerIcon
        ) : (
          <>
            <span className="searchable-filter__value" title={selectedLabel}>
              {selectedLabel}
            </span>
            <ChevronsUpDown size={14} aria-hidden="true" />
          </>
        )}
      </button>
      {panel}
    </div>
  );
}
