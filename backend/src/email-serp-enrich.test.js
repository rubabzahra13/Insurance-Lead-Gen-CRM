import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractEmailsFromText,
  sanitizeEmailCandidate,
  scoreEmailForLead,
  pickBestEmail,
  buildEmailSearchQuery,
  enrichLeadEmails,
} from './email-serp-enrich.js';

test('extractEmailsFromText finds and normalizes addresses', () => {
  const text = 'Reach Jane at Jane.Doe@Acme.io, or junk name@2x.png and noreply@x.com.';
  assert.deepEqual(extractEmailsFromText(text), [
    'jane.doe@acme.io',
    'name@2x.png',
    'noreply@x.com',
  ]);
});

test('sanitizeEmailCandidate rejects placeholders and image-like TLDs', () => {
  assert.equal(sanitizeEmailCandidate('name@2x.png'), null);
  assert.equal(sanitizeEmailCandidate('noreply@acme.com'), null);
  assert.equal(sanitizeEmailCandidate('privacy@acme.com'), null);
  assert.equal(sanitizeEmailCandidate('jane.doe@acme.io'), 'jane.doe@acme.io');
});

test('pickBestEmail prefers name-matching address over generic', () => {
  const lead = { name: 'Jane Doe', company: 'Acme Insurance' };
  const best = pickBestEmail(
    ['info@acme.com', 'jane.doe@gmail.com', 'bob@other.com'],
    lead,
  );
  assert.equal(best, 'jane.doe@gmail.com');
});

test('scoreEmailForLead boosts company domain when name matches', () => {
  const lead = { name: 'Jane Doe', company: 'Acme' };
  assert.ok(scoreEmailForLead('jane.doe@acme.com', lead) > scoreEmailForLead('jane.doe@gmail.com', lead));
});

test('buildEmailSearchQuery includes company when present', () => {
  assert.match(
    buildEmailSearchQuery({ name: 'Jane Doe', company: 'Acme Corp' }),
    /"Jane Doe".*"Acme Corp"/,
  );
  assert.match(buildEmailSearchQuery({ name: 'Jane Doe' }), /"Jane Doe"/);
});

test('enrichLeadEmails fills from snippet without calling Serp', async () => {
  const leads = [
    {
      name: 'Jane Doe',
      company: 'Acme',
      snippet: 'Contact jane.doe@acme.com for details',
    },
  ];
  let searched = 0;
  const out = await enrichLeadEmails(leads, {
    enabled: true,
    runSearch: async () => {
      searched += 1;
      return [];
    },
  });
  assert.equal(out[0].contact_email, 'jane.doe@acme.com');
  assert.equal(out[0].email_source, 'snippet');
  assert.equal(searched, 0);
});

test('enrichLeadEmails uses Serp when snippet has no email', async () => {
  const leads = [{ name: 'Jane Doe', company: 'Acme', snippet: 'Insurance agent in Texas' }];
  const out = await enrichLeadEmails(leads, {
    enabled: true,
    runSearch: async () => [
      { title: 'Jane Doe', snippet: 'Email jane.doe@acmeinsurance.com', link: 'https://example.org' },
    ],
  });
  assert.equal(out[0].contact_email, 'jane.doe@acmeinsurance.com');
  assert.equal(out[0].email_source, 'serpapi');
});

test('enrichLeadEmails does not overwrite existing contact_email', async () => {
  const leads = [{ name: 'Jane Doe', contact_email: 'keep@me.com', snippet: 'other@x.com' }];
  const out = await enrichLeadEmails(leads, {
    enabled: true,
    runSearch: async () => {
      throw new Error('should not search');
    },
  });
  assert.equal(out[0].contact_email, 'keep@me.com');
});
