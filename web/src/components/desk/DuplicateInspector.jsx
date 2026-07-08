import { confidencePercent } from '../../lib/confidence-tone.js';
import InspectorShell, { InspectorPill, LinkIcon } from './InspectorShell.jsx';

function formatMatchReason(reason) {
  if (!reason) return 'Unknown';
  const map = {
    link: 'LinkedIn URL',
    name: 'Name',
    company: 'Company',
    email: 'Email',
  };
  return map[reason.toLowerCase()] ?? reason;
}

function LeadBlock({ label, lead }) {
  const subtitle = [lead.title, lead.company, lead.location].filter(Boolean).join(' · ');
  const confidence = lead.confidence != null ? confidencePercent(lead.confidence) : null;

  return (
    <section className="inspector-lead-block">
      <p className="inspector-lead-block-label">{label}</p>
      <h3 className="inspector-lead-block-name">{lead.name}</h3>
      {subtitle && <p className="inspector-lead-block-meta">{subtitle}</p>}
      {lead.snippet && <p className="inspector-lead-block-text">{lead.snippet}</p>}
      <div className="inspector-lead-block-foot">
        {lead.status && <InspectorPill>{lead.status}</InspectorPill>}
        {confidence != null && <InspectorPill>{confidence}% match</InspectorPill>}
        {lead.link && (
          <a
            href={lead.link}
            target="_blank"
            rel="noopener noreferrer"
            className="desk-link-btn ml-auto"
            title="Open profile"
            aria-label={`Open ${lead.name} on LinkedIn`}
          >
            <LinkIcon />
          </a>
        )}
      </div>
    </section>
  );
}

export default function DuplicateInspector({ review, onResolve, onClose, resolving }) {
  if (!review) return null;

  const name = review.existingLead?.name ?? 'Duplicate review';

  return (
    <InspectorShell
      title={name}
      subtitle={`Matched by ${formatMatchReason(review.matchReason)}`}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            disabled={resolving}
            onClick={() => onResolve('merge')}
            className="desk-btn desk-btn-primary inspector-footer-btn"
          >
            Merge into existing
          </button>
          <div className="inspector-footer-row">
            <button
              type="button"
              disabled={resolving}
              onClick={() => onResolve('keep_both')}
              className="desk-btn desk-btn-secondary inspector-footer-btn"
            >
              Keep both
            </button>
            <button
              type="button"
              disabled={resolving}
              onClick={() => onResolve('dismiss')}
              className="desk-btn desk-btn-secondary inspector-footer-btn"
            >
              Dismiss
            </button>
          </div>
        </>
      }
    >
      <p className="inspector-notice is-compact">
        Compare the profiles below, then choose how to resolve this duplicate.
      </p>

      <div className="inspector-compare">
        <LeadBlock label="In your KB" lead={review.existingLead} />
        <LeadBlock label="New from run" lead={review.incomingLead} />
      </div>
    </InspectorShell>
  );
}
