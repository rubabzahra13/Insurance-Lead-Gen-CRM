#!/usr/bin/env node
import { config } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLeadPipeline } from './pipeline.js';
import { runSerpLeadPipeline } from './serp-pipeline.js';
import { buildAvatarSearch } from './avatar-prompts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..', '..');

config({ path: join(rootDir, '.env'), override: true });

const query = process.argv[2] ?? '';
const maxResults = Number(process.argv[3] ?? process.env.MAX_RESULTS ?? 25);

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function parseUiLocation() {
  const raw = process.env.SEARCH_LOCATION?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

async function main() {
  const role = (process.env.SEARCH_ROLE || query || '').trim();
  const uiLocation = parseUiLocation();
  const displayQuery = uiLocation?.label ? `${role} in ${uiLocation.label}` : role;

  if (!role) {
    throw new Error('role is required');
  }

  const avatarType = process.env.AVATAR_TYPE ?? 'avatar2';
  if ((avatarType === 'avatar1' || avatarType === 'avatar2') && !uiLocation?.placeId) {
    throw new Error('location is required — pick a city or country from the dropdown');
  }
  process.env.SOURCE_QUERY = displayQuery;

  // Experimental fast engine: SERP API retrieval instead of Claude web search.
  if ((process.env.SEARCH_PROVIDER ?? '').toLowerCase() === 'serpapi') {
    const result = await runSerpLeadPipeline(role, {
      maxResults,
      avatarType,
      uiLocation,
      role,
      onProgress: emit,
    });
    emit({ type: 'done', result });
    return;
  }

  const { searchPrompt, recipe, structureContext, label, enriched } = buildAvatarSearch(
    avatarType,
    displayQuery,
  );
  if (enriched) {
    emit({ type: 'log', message: `Targeting ${label} with an avatar-specific search plan` });
    if (!process.env.CLAUDE_WEB_SEARCH_MAX_USES) {
      process.env.CLAUDE_WEB_SEARCH_MAX_USES = '10';
    }
  }

  const result = await runLeadPipeline(searchPrompt, {
    maxResults,
    avatarType,
    searchRecipe: recipe,
    structureContext,
    onProgress: emit,
  });

  emit({ type: 'done', result });
}

main().catch((error) => {
  emit({ type: 'error', message: error.message });
  process.exitCode = 1;
});
