'use client';

import { useEffect, useRef, useState } from 'react';

const DOT_COUNT = 3;

export default function DotScrollArea({
  children,
  className = '',
  axis = 'vertical',
  ...props
}) {
  const viewportRef = useRef(null);
  const [activeDot, setActiveDot] = useState(0);
  const [showRail, setShowRail] = useState(false);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const update = () => {
      const scrollable =
        axis === 'vertical'
          ? el.scrollHeight - el.clientHeight
          : el.scrollWidth - el.clientWidth;

      if (scrollable <= 2) {
        setShowRail(false);
        return;
      }

      setShowRail(true);
      const position = axis === 'vertical' ? el.scrollTop : el.scrollLeft;
      setActiveDot(
        Math.min(DOT_COUNT - 1, Math.round((position / scrollable) * (DOT_COUNT - 1)))
      );
    };

    el.addEventListener('scroll', update, { passive: true });
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(el);
    update();

    return () => {
      el.removeEventListener('scroll', update);
      resizeObserver.disconnect();
    };
  }, [axis]);

  return (
    <div className={`dot-scroll dot-scroll--${axis}${className ? ` ${className}` : ''}`}>
      <div ref={viewportRef} className="dot-scroll__viewport" {...props}>
        {children}
      </div>
      {showRail && (
        <div className="dot-scroll__rail" aria-hidden="true">
          {Array.from({ length: DOT_COUNT }).map((_, index) => (
            <span
              key={index}
              className={`dot-scroll__dot${index === activeDot ? ' dot-scroll__dot--active' : ''}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
