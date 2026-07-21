import test from 'node:test';
import assert from 'node:assert/strict';
import { isSmallUsaCity, parseUsaState, usaLocationFallbacks } from './usa-search-expand.js';
import { assembleUsaRecallLanes, assembleSimplifiedRecallLanes, buildSimpleRoleWords } from './lane-assembler.js';

test('USA-001: Virginia City NV is small market with Reno + state fallbacks', () => {
  const location = {
    label: 'Virginia City, NV, USA',
    scope: 'city',
    city: 'Virginia City',
    state: 'NV',
    gl: 'us',
    country: 'United States',
    mustInclude: ['virginia city'],
  };
  assert.equal(isSmallUsaCity(location), true);
  const fallbacks = usaLocationFallbacks(location);
  assert.ok(fallbacks.some((f) => f.phrase.includes('Reno')));
  assert.ok(fallbacks.some((f) => f.type === 'state' && f.phrase.includes('Nevada')));
});

test('USA-002: Dallas is not treated as small market', () => {
  const location = {
    label: 'Dallas, TX, USA',
    scope: 'city',
    city: 'Dallas',
    state: 'TX',
    gl: 'us',
    mustInclude: ['dallas'],
  };
  assert.equal(isSmallUsaCity(location), false);
  assert.equal(usaLocationFallbacks(location).length, 0);
});

test('USA-003: recall lanes added for insurance telesales in small NV city', () => {
  const plan = {
    roleTerms: ['insurance telesales'],
    roleSynonyms: ['insurance agent', 'insurance producer', 'insurance sales agent'],
    relatedTitles: ['customer service representative'],
    location: {
      label: 'Virginia City, NV, USA',
      scope: 'city',
      city: 'Virginia City',
      state: 'NV',
      gl: 'us',
    },
  };
  const lanes = assembleUsaRecallLanes('avatar2', plan);
  assert.ok(lanes.length >= 2);
  assert.ok(lanes.some((l) => l.query.includes('Reno')));
  assert.ok(lanes.some((l) => l.query.includes('Nevada')));
  assert.ok(lanes.every((l) => l.query.includes('site:linkedin.com/in')));
  assert.ok(lanes.every((l) => !l.query.includes(' OR '))); // simplified format
});

test('USA-004: parseUsaState from label', () => {
  const state = parseUsaState({ label: 'Virginia City, NV, USA' });
  assert.equal(state?.abbr, 'NV');
  assert.equal(state?.name, 'Nevada');
});

test('USA-005: Dallas gets simplified recall lanes (not small-city metro fallback)', () => {
  const plan = {
    roleTerms: ['insurance telesales'],
    roleSynonyms: ['insurance telesales representative', 'insurance sales agent', 'licensed insurance agent'],
    relatedTitles: ['customer service representative'],
    location: {
      label: 'Dallas, TX, USA',
      scope: 'city',
      city: 'Dallas',
      state: 'TX',
      gl: 'us',
    },
  };
  const lanes = assembleSimplifiedRecallLanes('avatar2', plan);
  assert.ok(lanes.length >= 1);
  assert.ok(lanes.every((l) => !l.query.includes(' OR ')));
  assert.ok(lanes.some((l) => l.query.includes('Dallas')));
  assert.ok(lanes.some((l) => /insurance telesales|insurance sales agent/i.test(l.query)));
  assert.equal(assembleUsaRecallLanes('avatar2', plan).length, 0);
});

test('USA-006: buildSimpleRoleWords keeps AI role terms (no industry stripping)', () => {
  const words = buildSimpleRoleWords({
    roleTerms: ['insurance telesales'],
    roleSynonyms: ['insurance sales agent', 'licensed insurance producer'],
  });
  assert.match(words, /insurance/i);
  assert.match(words, /telesales|sales agent|producer/i);
});
