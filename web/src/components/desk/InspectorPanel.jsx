import { confidencePercent } from '../../lib/confidence-tone.js';
import { useEffect, useState } from 'react';
import { fetchLeadRuns } from '../../lib/api.js';
import { formatDate } from '../../lib/format-date.js';
import { formatVerificationNotes } from '../../lib/format-verification.js';
import { isPersistedLead } from '../../lib/lead-utils.js';
import InspectorShell, {
  InspectorPill,
  InspectorStat,
  LinkIcon,
  StarIcon,
  TrashIcon,
} from './InspectorShell.jsx';

function Field({ label, children }) {
  return (
    <div className="inspector-field">
      <label>{label}</label>
      {children}
    </div>
  );
}

function Group({ title, children }) {
  return (
    <section className="inspector-group">
      <h3 className="inspector-group-title">{title}</h3>
      <div className="inspector-group-body">{children}</div>
    </section>
  );
}

const PROFILE_FIELDS = [
  ['name', 'Name', false],
  ['title', 'Title', false],
  ['company', 'Company', false],
  ['location', 'Location', false],
  ['link', 'LinkedIn URL', false],
];

const DETAIL_FIELDS = [
  ['snippet', 'Summary', true],
  ['evidence', 'Evidence', true],
  ['notes', 'Notes', true],
];

export default function InspectorPanel({ lead, onClose, onUpdate, onDelete, onFilterByRun }) {
  const [tagInput, setTagInput] = useState('');
  const [runHistory, setRunHistory] = useState([]);
  const persisted = isPersistedLead(lead);

  useEffect(() => {
    if (!persisted) {
      setRunHistory([]);
      return;
    }
    fetchLeadRuns(lead.id)
      .then((data) => setRunHistory(data.runs ?? []))
      .catch(() => setRunHistory([]));
  }, [lead?.id, persisted]);

  if (!lead) return null;

  async function save(field, value) {
    if (!persisted) return;
    await onUpdate(lead.id, { [field]: value });
  }

  function addTag() {
    if (!persisted) return;
    const tag = tagInput.trim();
    if (!tag || lead.tags?.includes(tag)) return;
    onUpdate(lead.id, { tags: [...(lead.tags ?? []), tag] });
    setTagInput('');
  }

  const subtitle = [lead.title, lead.company].filter(Boolean).join(' · ');
  const confidence = confidencePercent(lead.confidence);

  function renderField([key, label, multiline]) {
    const value = lead[key] ?? '';
    const shared = {
      defaultValue: value,
      disabled: !persisted,
      className: `inspector-input${multiline ? ' is-textarea' : ''}`,
      onBlur: (e) => save(key, e.target.value),
      placeholder: multiline ? `Add ${label.toLowerCase()}…` : undefined,
    };

    return (
      <Field key={key} label={label}>
        {multiline ? <textarea rows={3} {...shared} /> : <input type="text" {...shared} />}
      </Field>
    );
  }

  return (
    <InspectorShell
      title={lead.name}
      subtitle={subtitle}
      onClose={onClose}
      stat={<InspectorStat value={`${confidence}%`} label="match" />}
      actions={
        <>
          <button
            type="button"
            disabled={!persisted}
            onClick={() => onUpdate(lead.id, { starred: !lead.starred })}
            className={`inspector-action-btn${lead.starred ? ' is-active' : ''}`}
            title={lead.starred ? 'Unstar' : 'Star'}
            aria-label={lead.starred ? 'Unstar lead' : 'Star lead'}
          >
            <StarIcon filled={lead.starred} />
          </button>
          {lead.link && (
            <a
              href={lead.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inspector-action-btn"
              title="Open LinkedIn profile"
              aria-label="Open LinkedIn profile"
            >
              <LinkIcon />
            </a>
          )}
          <button
            type="button"
            disabled={!persisted}
            onClick={() => onDelete(lead.id)}
            className="inspector-action-btn"
            title="Delete lead"
            aria-label="Delete lead"
          >
            <TrashIcon />
          </button>
        </>
      }
    >
      {!persisted && (
        <div className="inspector-notice">
          This lead is still being saved. Editing will be available in a moment.
        </div>
      )}

      <div key={lead.id} className="inspector-stack">
        <Group title="Profile">{PROFILE_FIELDS.map(renderField)}</Group>

        <Group title="Details">
          {lead.status && (
            <div className="inspector-field">
              <label>Status</label>
              <InspectorPill>{lead.status}</InspectorPill>
            </div>
          )}
          {DETAIL_FIELDS.map(renderField)}
        </Group>

        <Group title="Tags">
          {(lead.tags ?? []).length > 0 ? (
            <div className="inspector-tags">
              {(lead.tags ?? []).map((tag) => (
                <button
                  key={tag}
                  type="button"
                  disabled={!persisted}
                  onClick={() => onUpdate(lead.id, { tags: lead.tags.filter((t) => t !== tag) })}
                  className="inspector-tag"
                >
                  {tag}
                  <span className="inspector-tag-remove" aria-hidden="true">
                    ×
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="inspector-empty">No tags yet</p>
          )}
          <div className="inspector-tag-row">
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
              placeholder="Add a tag…"
              disabled={!persisted}
              className="inspector-input"
            />
            <button type="button" onClick={addTag} disabled={!persisted} className="inspector-tag-add">
              Add
            </button>
          </div>
        </Group>

        {lead.verificationNotes && (
          <Group title="Verification">
            <p className="inspector-text">{formatVerificationNotes(lead.verificationNotes)}</p>
          </Group>
        )}

        {runHistory.length > 0 && (
          <Group title="Found in searches">
            <div className="inspector-run-list">
              {runHistory.map((run) => (
                <button
                  key={run.runId}
                  type="button"
                  onClick={() => onFilterByRun?.(run.runId)}
                  className="inspector-run-card"
                >
                  <p className="inspector-run-title">{run.searchPrompt}</p>
                  <p className="inspector-run-meta">
                    {formatDate(run.startedAt)} · {run.status}
                  </p>
                </button>
              ))}
            </div>
          </Group>
        )}
      </div>
    </InspectorShell>
  );
}
