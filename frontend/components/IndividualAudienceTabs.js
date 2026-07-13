'use client';

import { usePathname } from 'next/navigation';
import SegmentToggle from './SegmentToggle';

export default function IndividualAudienceTabs() {
  const pathname = usePathname();

  if (pathname !== '/recruitment') {
    return null;
  }

  return <SegmentToggle />;
}
