import { createDuplicateReview } from './duplicates.js';
import { findExistingLead, insertLead, linkLeadToRun, mergeLeadData, updateLead } from './leads.js';

function leadsDiffer(existing, incoming) {
  const fields = ['title', 'company', 'location', 'snippet'];
  return fields.some((field) => {
    const a = (existing[field] ?? '').trim().toLowerCase();
    const b = (incoming[field] ?? '').trim().toLowerCase();
    return a && b && a !== b;
  });
}

export async function importRunLeadsToKb(runId, leads = []) {
  let leadsAdded = 0;
  let duplicatesFound = 0;

  for (const lead of leads) {
    const match = await findExistingLead(lead);

    if (match) {
      await linkLeadToRun(match.lead.id, runId, true);

      if (leadsDiffer(match.lead, lead)) {
        await createDuplicateReview({
          runId,
          existingLeadId: match.lead.id,
          incomingLead: lead,
          matchReason: match.reason,
        });
        duplicatesFound += 1;
      }
      continue;
    }

    const created = await insertLead(lead);
    await linkLeadToRun(created.id, runId, true);
    leadsAdded += 1;
  }

  return { leadsAdded, duplicatesFound };
}

export async function mergeDuplicateIntoExisting(review) {
  const merged = mergeLeadData(review.existingLead, review.incomingLead);
  const updated = await updateLead(review.existingLead.id, merged);
  await linkLeadToRun(updated.id, review.runId, true);
  return updated;
}

export async function addIncomingAsNewLead(review) {
  const created = await insertLead(review.incomingLead);
  await linkLeadToRun(created.id, review.runId, true);
  return created;
}
