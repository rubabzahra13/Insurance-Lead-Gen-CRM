'use client';

import { LEAD_SEGMENTS, useIndividualSegment } from '../context/IndividualSegmentContext';

export default function SegmentToggle({ className = '' }) {
  const { leadSegment, setLeadSegment, segmentCounts } = useIndividualSegment();

  return (
    <div
      className={`topbar-segment-toggle${className ? ` ${className}` : ''}`}
      role="tablist"
      aria-label="Lead audience"
    >
      {LEAD_SEGMENTS.map((segment) => {
        const isActive = leadSegment === segment.id;
        return (
          <button
            key={segment.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`topbar-segment-toggle__option${isActive ? ' topbar-segment-toggle__option--active' : ''}`}
            onClick={() => setLeadSegment(segment.id)}
          >
            <span className="topbar-segment-toggle__label">{segment.shortLabel}</span>
            <span className="topbar-segment-toggle__count">{segmentCounts[segment.id] || 0}</span>
          </button>
        );
      })}
    </div>
  );
}
