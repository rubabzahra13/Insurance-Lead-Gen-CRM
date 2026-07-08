import { randomUUID } from 'node:crypto';
import { importRunLeadsToKb } from './import-run.js';
import { completeRun, getRun, insertRun } from './runs.js';
import { activeProvider } from '../llm.js';

export async function persistPipelineToKb({
  query,
  searchPrompt,
  maxResults,
  result,
  error,
  startedAt,
  finishedAt,
  runId,
}) {
  const id = runId ?? randomUUID();
  const started = startedAt ?? new Date().toISOString();
  const finished = finishedAt ?? new Date().toISOString();

  const existing = runId ? await getRun(runId) : null;
  if (!existing) {
    await insertRun({
      id,
      query,
      searchPrompt,
      maxResults,
      provider: activeProvider(),
      startedAt: started,
    });
  }

  let importStats = { leadsAdded: 0, duplicatesFound: 0 };
  if (result?.leads?.length) {
    importStats = await importRunLeadsToKb(id, result.leads);
  }

  await completeRun({
    id,
    status: error ? 'error' : 'done',
    error: error ?? null,
    finishedAt: finished,
    rawPath: result?.rawPath ?? null,
    stats: result?.stats ?? null,
    trace: result?.trace ?? null,
    result,
    leadsAdded: importStats.leadsAdded,
    duplicatesFound: importStats.duplicatesFound,
  });

  return { runId: id, ...importStats };
}
