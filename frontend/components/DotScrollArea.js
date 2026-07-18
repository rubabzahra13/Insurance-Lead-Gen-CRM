'use client';

import { useEffect, useRef, useState } from 'react';

const DOT_COUNT = 3;

function getScrollMetrics(el, axis) {
  if (axis === 'vertical') {
    return {
      scrollable: el.scrollHeight - el.clientHeight,
      position: el.scrollTop,
    };
  }
  return {
    scrollable: el.scrollWidth - el.clientWidth,
    position: el.scrollLeft,
  };
}

export default function DotScrollArea({
  children,
  className = '',
  axis = 'vertical',
  /** When true, track the first textarea/[data-dot-scroll-target] inside the viewport. */
  trackNestedScroll = false,
  ...props
}) {
  const viewportRef = useRef(null);
  const [activeDot, setActiveDot] = useState(0);
  const [showRail, setShowRail] = useState(false);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const resolveScrollEl = () => {
      if (!trackNestedScroll) return viewport;
      return (
        viewport.querySelector('textarea, [data-dot-scroll-target]') || viewport
      );
    };

    let scrollEl = resolveScrollEl();

    const update = () => {
      scrollEl = resolveScrollEl();
      const { scrollable, position } = getScrollMetrics(scrollEl, axis);

      if (scrollable <= 2) {
        setShowRail(false);
        return;
      }

      setShowRail(true);
      setActiveDot(
        Math.min(DOT_COUNT - 1, Math.round((position / scrollable) * (DOT_COUNT - 1)))
      );
    };

    const bindScroll = (el) => {
      el.addEventListener('scroll', update, { passive: true });
      return () => el.removeEventListener('scroll', update);
    };

    let unbindScroll = bindScroll(scrollEl);
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(viewport);
    resizeObserver.observe(scrollEl);

    const mutationObserver = new MutationObserver(() => {
      const next = resolveScrollEl();
      if (next !== scrollEl) {
        unbindScroll();
        scrollEl = next;
        unbindScroll = bindScroll(scrollEl);
        resizeObserver.observe(scrollEl);
      }
      update();
    });
    mutationObserver.observe(viewport, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    update();

    return () => {
      unbindScroll();
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [axis, trackNestedScroll]);

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
