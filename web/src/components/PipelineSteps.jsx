import { useEffect, useMemo, useState } from 'react';

const MILESTONES = [
  { label: 'Web search', match: (step) => step === 'Web search' || step === 'Expanding search details' },
  {
    label: 'Structuring leads',
    match: (step) => step === 'LLM reading & structuring results',
  },
  {
    label: 'Resolving links',
    match: (step) => step.startsWith('Link resolver') || step.startsWith('Re-resolve'),
    optional: true,
  },
  {
    label: 'Confirming links',
    match: (step) => step === 'Confirming links against search index',
  },
  { label: 'Scoring confidence', match: (step) => step === 'Scoring confidence' },
];

function milestoneIndex(label) {
  if (!label) return -1;
  return MILESTONES.findIndex((m) => m.match(label));
}

function collectStepState(events) {
  const done = new Set();
  let current = null;

  for (const event of events) {
    if (event.type === 'step_done') done.add(event.label);
    if (event.type === 'step_start') current = event.label;
  }

  return { done, current };
}

function milestoneStarted(milestone, events) {
  return events.some(
    (e) => (e.type === 'step_start' || e.type === 'step_done') && milestone.match(e.label),
  );
}

function milestoneFinished(milestone, events, current, running) {
  const started = events.filter((e) => e.type === 'step_start' && milestone.match(e.label));
  const finished = events.filter((e) => e.type === 'step_done' && milestone.match(e.label));
  if (!started.length) return false;

  const allStartedDone = started.every((s) => finished.some((f) => f.label === s.label));
  const movedOn = current && !milestone.match(current) && milestoneIndex(current) > MILESTONES.indexOf(milestone);

  return allStartedDone && (!running || movedOn);
}

export function buildPhaseProgress(events, running) {
  const failed = events.some((e) => e.type === 'error');
  const { current } = collectStepState(events);
  const phases = [];

  for (const milestone of MILESTONES) {
    const started = milestoneStarted(milestone, events);
    const isCurrent = Boolean(running && current && milestone.match(current));
    const isDone = milestoneFinished(milestone, events, current, running) || (!running && !failed && started);

    if (milestone.optional && !started && !isCurrent) continue;

    let percent = 0;
    if (isDone) {
      percent = 100;
    } else if (isCurrent) {
      const substeps = events.filter(
        (e) =>
          (e.type === 'step_start' || e.type === 'step_done') && milestone.match(e.label),
      );
      const startedLabels = [...new Set(substeps.filter((e) => e.type === 'step_start').map((e) => e.label))];
      const doneLabels = new Set(substeps.filter((e) => e.type === 'step_done').map((e) => e.label));
      const completed = startedLabels.filter((label) => doneLabels.has(label)).length;
      const total = Math.max(startedLabels.length, 1);
      percent = Math.min(95, Math.round((completed / total) * 40 + 35));
    } else if (started && milestoneFinished(milestone, events, current, running)) {
      percent = 100;
    }

    phases.push({
      label: milestone.label,
      percent,
      status: isDone ? 'done' : isCurrent ? 'running' : started ? 'done' : 'pending',
    });
  }

  if (!phases.length && running) {
    phases.push({ label: 'Starting…', percent: 5, status: 'running' });
  }

  return phases;
}

function PhaseRow({ label, percent, status }) {
  const isDone = status === 'done' || percent >= 100;
  const isRunning = status === 'running';

  return (
    <div className="rounded-lg border border-border bg-panel px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className={`text-sm ${isDone ? 'text-fg-secondary' : isRunning ? 'text-fg' : 'text-muted'}`}>
          {label}
        </p>
        <p
          className={`text-sm font-semibold tabular-nums ${
            isDone ? 'text-accent' : isRunning ? 'text-accent' : 'text-muted'
          }`}
        >
          {percent}%
        </p>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${
            isDone ? 'bg-accent' : isRunning ? 'bg-accent/80' : 'bg-border'
          }`}
          style={{ width: `${percent}%` }}
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${label} progress`}
        />
      </div>
    </div>
  );
}

export default function PipelineSteps({ events, running }) {
  const basePhases = useMemo(() => buildPhaseProgress(events, running), [events, running]);
  const [creep, setCreep] = useState(0);

  const activeIndex = basePhases.findIndex((p) => p.status === 'running');

  useEffect(() => {
    if (!running || activeIndex < 0) {
      setCreep(0);
      return undefined;
    }

    setCreep(0);
    const timer = setInterval(() => {
      setCreep((n) => Math.min(45, n + 2));
    }, 1200);

    return () => clearInterval(timer);
  }, [running, activeIndex, basePhases[activeIndex]?.label]);

  const phases = basePhases.map((phase, i) => {
    if (phase.status !== 'running') return phase;
    return { ...phase, percent: Math.min(95, phase.percent + creep) };
  });

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">Usually finishes within 2 minutes</p>
      {phases.map((phase) => (
        <PhaseRow key={phase.label} {...phase} />
      ))}
    </div>
  );
}
