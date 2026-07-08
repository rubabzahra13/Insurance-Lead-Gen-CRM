import { LinkIcon } from './InspectorShell.jsx';

function DuplicateQueueTable({ reviews, selectedId, onSelect }) {
  return (
    <div className="desk-panel flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="desk-scroll flex-1 overflow-y-auto overflow-x-hidden">
        <div
          className="lead-grid"
          role="table"
          aria-label="Duplicate review queue"
          style={{
            '--lead-grid-cols': 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 0.75fr) 2.25rem',
          }}
        >
          <div
            className="lead-grid-header"
            role="row"
            style={{ gridTemplateColumns: 'var(--lead-grid-cols)' }}
          >
            <div role="columnheader">KB lead</div>
            <div role="columnheader">Incoming</div>
            <div role="columnheader">Match</div>
            <div role="columnheader" className="lead-grid-cell-center">
              Link
            </div>
          </div>

          {reviews.length === 0 ? (
            <div className="lead-grid-empty text-stone-400">
              No duplicates pending — you&apos;re all caught up.
            </div>
          ) : (
            reviews.map((review) => (
              <div
                key={review.id}
                role="row"
                onClick={() => onSelect(review)}
                className={`lead-grid-row ${selectedId === review.id ? 'is-selected' : ''}`}
                style={{ gridTemplateColumns: 'var(--lead-grid-cols)' }}
              >
                <div className="lead-grid-cell" role="cell">
                  <p className="lead-grid-cell-name">{review.existingLead.name}</p>
                  <p className="desk-subheading mt-0.5">{review.existingLead.company}</p>
                </div>
                <div className="lead-grid-cell" role="cell">
                  <p className="lead-grid-cell-name">{review.incomingLead.name}</p>
                  <p className="desk-subheading mt-0.5">{review.incomingLead.company}</p>
                </div>
                <div className="lead-grid-cell" role="cell">
                  <span className="inline-flex rounded-md bg-stone-100 px-2 py-0.5 text-[var(--desk-subheading)] font-medium text-stone-600">
                    {review.matchReason}
                  </span>
                </div>
                <div className="lead-grid-cell lead-grid-cell-center" role="cell">
                  {(() => {
                    const linkLead = review.incomingLead.link
                      ? review.incomingLead
                      : review.existingLead.link
                        ? review.existingLead
                        : null;
                    return linkLead?.link ? (
                      <a
                        href={linkLead.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="desk-link-btn"
                        aria-label={`Open ${linkLead.name} on LinkedIn`}
                        title="Open profile"
                      >
                        <LinkIcon />
                      </a>
                    ) : (
                      <span className="lead-grid-cell-empty" aria-hidden="true" />
                    );
                  })()}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default DuplicateQueueTable;
