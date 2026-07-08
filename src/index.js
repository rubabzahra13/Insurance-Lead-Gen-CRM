#!/usr/bin/env node
import { config } from 'dotenv';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

config({
  path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env'),
  override: true,
});

import { runLeadPipeline } from './pipeline.js';
import { appendLeadsToSheet, isSheetsConfigured } from './sheets.js';
import { writeLeadsToXlsx } from './xlsx.js';
import { parseSearchPrompt, sleep } from './utils.js';
import { initDb } from './db/index.js';
import { persistPipelineToKb } from './db/persist-run.js';

function printUsage() {
  console.log(`Usage:
  npm run scrape -- "scrape linkedin CEOs in san francisco"
  npm run scrape -- "CEOs in automotive united states"

Environment:
  LLM_PROVIDER                claude (default) or gemini
  ANTHROPIC_API_KEY           Required when LLM_PROVIDER=claude
  GEMINI_API_KEY              Required when LLM_PROVIDER=gemini
  MIN_CONFIDENCE              Default 0.55 (quality gate)
  REQUIRE_VERIFIED_LINK       Default false (set true for strict mode)
  OUTPUT_XLSX                 Default ./output/leads.xlsx
`);
}

function formatLeadLine(lead) {
  const parts = [
    lead.name ?? '(no name)',
    lead.title,
    lead.company,
    lead.location,
  ].filter(Boolean);

  const headline = parts.join(' · ');
  const confidence = `${Math.round((lead.confidence ?? 0) * 100)}%`;
  const status = lead.status ?? 'unknown';

  const meta = `[${status}, ${confidence}]`;
  const linkLine = lead.link ? `\n    ${lead.link}` : '';
  return `${headline} ${meta}${linkLine}`;
}

function printTrace(trace) {
  console.log('Agent trace:');
  for (const step of trace) {
    const { name, status, ...rest } = step;
    const detail = Object.entries(rest)
      .map(([key, value]) => `${key}=${value}`)
      .join(', ');
    console.log(`  ${name}${status ? ` (${status})` : ''}${detail ? ` — ${detail}` : ''}`);
  }
  console.log('');
}

async function main() {
  const rawInput = process.argv.slice(2).join(' ').trim();
  if (!rawInput || rawInput === '--help' || rawInput === '-h') {
    printUsage();
    process.exit(rawInput ? 0 : 1);
  }

  const searchPrompt = parseSearchPrompt(rawInput);
  if (!searchPrompt) {
    console.error('Error: provide a search query, e.g. "scrape linkedin CEOs in san francisco"');
    process.exit(1);
  }

  console.log(`Searching LinkedIn leads: "${searchPrompt}"`);
  console.log('Pipeline: search → store raw → LLM structure → verify → export');
  console.log(
    `Limits: max ${process.env.MAX_RESULTS ?? 25} leads, resolve up to ${process.env.LINK_RESOLVE_MAX_TARGETS ?? process.env.MAX_RESULTS ?? 25} missing links\n`,
  );

  const startedAt = new Date().toISOString();
  const { leads, rejected, trace, stats } = await runLeadPipeline(searchPrompt);
  const finishedAt = new Date().toISOString();
  printTrace(trace);

  if (process.env.DATABASE_URL || process.env.SUPABASE_POOLER_URL) {
    try {
      await initDb();
      const kb = await persistPipelineToKb({
        query: rawInput,
        searchPrompt,
        maxResults: Number(process.env.MAX_RESULTS ?? 25),
        result: { leads, rejected, trace, stats },
        startedAt,
        finishedAt,
      });
      console.log(
        `KB: ${kb.leadsAdded} lead(s) added, ${kb.duplicatesFound} duplicate(s) flagged (run ${kb.runId})\n`,
      );
    } catch (err) {
      console.warn(`KB save skipped: ${err.message}\n`);
    }
  }

  if (leads.length === 0) {
    console.log(`No leads passed quality gate (min confidence ${process.env.MIN_CONFIDENCE ?? 0.55}).`);
    if (rejected.length > 0) {
      console.log(`${rejected.length} candidate(s) rejected. See output/rejected-leads.json`);
      mkdirSync('./output', { recursive: true });
      writeFileSync('./output/rejected-leads.json', JSON.stringify(rejected, null, 2));
    }
    process.exit(0);
  }

  console.log(
    `Exporting ${leads.length} lead(s) — avg confidence ${stats.avgConfidence}, ${stats.verifiedLinks} verified links:\n`,
  );

  for (const lead of leads) {
    console.log(`  • ${formatLeadLine(lead)}`);
    if (lead.snippet) {
      console.log(`    ${lead.snippet.slice(0, 140)}${lead.snippet.length > 140 ? '...' : ''}`);
    }
    console.log('');
  }

  if (rejected.length > 0) {
    mkdirSync('./output', { recursive: true });
    writeFileSync('./output/rejected-leads.json', JSON.stringify(rejected, null, 2));
    console.log(`${rejected.length} low-confidence candidate(s) saved to output/rejected-leads.json\n`);
  }

  if (isSheetsConfigured()) {
    await sleep(2000);
    const result = await appendLeadsToSheet(leads);
    console.log(`Saved ${result.count} row(s) to Google Sheet (${result.sheetName}).`);
  } else {
    const xlsxPath = process.env.OUTPUT_XLSX ?? './output/leads.xlsx';
    const result = writeLeadsToXlsx(leads, xlsxPath);
    console.log(
      `Saved ${result.count} lead(s) to ${result.filePath} (${result.total} unique rows total after dedupe)`,
    );
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
