'use client';

import React, { createContext, useContext, useMemo, useState } from 'react';
import { AVATAR_LABELS } from '../lib/avatar-labels';

export const LEAD_SEGMENTS = [
  {
    id: 'avatar1',
    label: AVATAR_LABELS.avatar1,
    shortLabel: 'Job seekers',
    desc: 'Professionals exploring insurance careers',
  },
  {
    id: 'avatar2',
    label: AVATAR_LABELS.avatar2,
    shortLabel: 'Job upgraders',
    desc: 'Experienced agents ready to level up',
  },
];

const IndividualSegmentContext = createContext(null);

export function IndividualSegmentProvider({ children }) {
  const [leadSegment, setLeadSegment] = useState('avatar1');
  const [segmentCounts, setSegmentCounts] = useState({ avatar1: 0, avatar2: 0 });

  const value = useMemo(
    () => ({ leadSegment, setLeadSegment, segmentCounts, setSegmentCounts }),
    [leadSegment, segmentCounts]
  );

  return (
    <IndividualSegmentContext.Provider value={value}>
      {children}
    </IndividualSegmentContext.Provider>
  );
}

export function useIndividualSegment() {
  const context = useContext(IndividualSegmentContext);
  if (!context) {
    throw new Error('useIndividualSegment must be used within IndividualSegmentProvider');
  }
  return context;
}
