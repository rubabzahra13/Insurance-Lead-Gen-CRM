import test from 'node:test';
import assert from 'node:assert/strict';
import { mapGooglePlaceToBusinessLead } from './avatar3-places.js';

test('mapGooglePlaceToBusinessLead maps google places result into business lead shape', () => {
  const mapped = mapGooglePlaceToBusinessLead(
    {
      name: 'Coffee Bar',
      displayName: { text: 'Coffee Bar' },
      formattedAddress: '123 Main St, Austin, TX',
      id: 'abc123',
      rating: 4.7,
      businessStatus: 'OPERATIONAL',
      currentOpeningHours: { openNow: true },
    },
    {
      website: 'https://coffeebar.example',
      formatted_phone_number: '(512) 555-0100',
    },
  );

  assert.deepEqual(mapped, {
    business_name: 'Coffee Bar',
    address: '123 Main St, Austin, TX',
    website: 'https://coffeebar.example',
    google_place_id: 'abc123',
    rating: 4.7,
    open_status: 'OPERATIONAL',
    phone: '(512) 555-0100',
    photo_name: null,
  });
});

test('mapGooglePlaceToBusinessLead includes first photo resource name', () => {
  const mapped = mapGooglePlaceToBusinessLead({
    displayName: { text: 'Bakery' },
    id: 'place-1',
    photos: [{ name: 'places/place-1/photos/abc' }],
  });
  assert.equal(mapped.photo_name, 'places/place-1/photos/abc');
});
