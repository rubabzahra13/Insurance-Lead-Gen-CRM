const GOOGLE_PLACES_TEXT_SEARCH = 'https://places.googleapis.com/v1/places:searchText';

export function mapGooglePlaceToBusinessLead(place, details = {}) {
  return {
    business_name: place?.displayName?.text ?? place?.name ?? '',
    address: place?.formattedAddress ?? place?.vicinity ?? null,
    website: place?.websiteUri ?? details?.website ?? null,
    google_place_id: place?.id ?? place?.place_id ?? null,
    rating: place?.rating ?? null,
    open_status:
      place?.businessStatus ??
      place?.business_status ??
      (place?.currentOpeningHours?.openNow === true
        ? 'OPEN'
        : place?.currentOpeningHours?.openNow === false
          ? 'CLOSED_TEMPORARILY'
          : null),
    phone:
      place?.nationalPhoneNumber ??
      place?.internationalPhoneNumber ??
      details?.formatted_phone_number ??
      details?.international_phone_number ??
      null,
  };
}

export async function searchGooglePlaces({ query, locationBias = null, apiKey }) {
  const trimmedQuery = String(query ?? '').trim();
  const trimmedKey = String(apiKey ?? '').trim();

  if (!trimmedQuery) {
    const error = new Error('query is required');
    error.status = 400;
    throw error;
  }

  if (!trimmedKey) {
    const error = new Error('PLACES_API_KEY is missing or empty in the root .env file.');
    error.status = 502;
    throw error;
  }

  const body = {
    textQuery: locationBias ? `${trimmedQuery} ${String(locationBias).trim()}`.trim() : trimmedQuery,
  };

  const searchResponse = await fetch(GOOGLE_PLACES_TEXT_SEARCH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': trimmedKey,
      'X-Goog-FieldMask':
        'places.displayName,places.formattedAddress,places.id,places.rating,places.businessStatus,places.currentOpeningHours,places.websiteUri,places.nationalPhoneNumber,places.internationalPhoneNumber',
    },
    body: JSON.stringify(body),
  });
  if (searchResponse.status === 429) {
    const error = new Error('Google Places rate limit reached');
    error.status = 429;
    error.retryAfter = searchResponse.headers.get('retry-after');
    throw error;
  }

  const searchData = await searchResponse.json().catch(() => ({}));
  if (!searchResponse.ok) {
    const error = new Error(searchData.error_message ?? 'Google Places request failed');
    error.status = searchResponse.status === 429 ? 429 : 502;
    if (searchResponse.status === 429) {
      error.retryAfter = searchResponse.headers.get('retry-after');
    }
    throw error;
  }

  if (searchData.error) {
    const error = new Error(searchData.error.message ?? 'Google Places request failed');
    error.status = 502;
    throw error;
  }

  return Array.isArray(searchData.places)
    ? searchData.places.map((place) => mapGooglePlaceToBusinessLead(place))
    : [];
}
