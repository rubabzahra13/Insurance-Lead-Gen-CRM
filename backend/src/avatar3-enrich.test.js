import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichBusinessWebsite } from './avatar3-enrich.js';

test('enrichBusinessWebsite returns nulls when website fetch fails', async () => {
  const result = await enrichBusinessWebsite({
    website: 'https://example.invalid',
    businessName: 'Broken Site LLC',
    fetchImpl: async () => {
      throw new Error('network down');
    },
    generateStructured: async () => {
      throw new Error('should not be called');
    },
  });

  assert.deepEqual(result, {
    owner_name: null,
    manager_name: null,
    contact_email: null,
    contact_linkedin: null,
    source_text: '',
  });
});

test('enrichBusinessWebsite returns nulls when Claude extraction fails', async () => {
  const result = await enrichBusinessWebsite({
    website: 'https://example.com',
    businessName: 'Example Business',
    fetchImpl: async (url) => {
      if (url === 'https://example.com') {
        return new Response(
          '<html><body><a href="/contact">Contact</a><p>Owner.com demo text</p></body></html>',
          { status: 200, headers: { 'content-type': 'text/html' } },
        );
      }
      return new Response('<html><body>contact page</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    },
    generateStructured: async () => {
      throw new Error('LLMResponseError');
    },
  });

  assert.deepEqual(result, {
    owner_name: null,
    manager_name: null,
    contact_email: null,
    contact_linkedin: null,
    source_text: 'URL: https://example.com\nContact Owner.com demo text\n\nURL: https://example.com/contact\ncontact page',
  });
});
