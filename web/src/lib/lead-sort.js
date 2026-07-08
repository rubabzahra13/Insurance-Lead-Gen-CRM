export const SORT_OPTIONS = [
  { value: 'updated_at:desc', field: 'updated_at', order: 'desc', label: 'Recently updated' },
  { value: 'created_at:desc', field: 'created_at', order: 'desc', label: 'Newest added' },
  { value: 'created_at:asc', field: 'created_at', order: 'asc', label: 'Oldest added' },
  { value: 'name:asc', field: 'name', order: 'asc', label: 'Name A → Z' },
  { value: 'name:desc', field: 'name', order: 'desc', label: 'Name Z → A' },
  { value: 'title:asc', field: 'title', order: 'asc', label: 'Title A → Z' },
  { value: 'company:asc', field: 'company', order: 'asc', label: 'Company A → Z' },
  { value: 'location:asc', field: 'location', order: 'asc', label: 'Location A → Z' },
  { value: 'confidence:desc', field: 'confidence', order: 'desc', label: 'Score: high to low' },
  { value: 'confidence:asc', field: 'confidence', order: 'asc', label: 'Score: low to high' },
];

export const DUPLICATE_SORT_OPTIONS = [
  { value: 'name:asc', label: 'Name A → Z' },
  { value: 'name:desc', label: 'Name Z → A' },
  { value: 'company:asc', label: 'Company A → Z' },
  { value: 'reason:asc', label: 'Match type' },
];

export const DEFAULT_SORT = { field: 'updated_at', order: 'desc' };

export function defaultSortForView(view) {
  if (view === 'new') return { field: 'created_at', order: 'desc' };
  return { ...DEFAULT_SORT };
}

export function sortToValue(sort) {
  return `${sort.field}:${sort.order}`;
}

export function sortFromValue(value) {
  const option = SORT_OPTIONS.find((o) => o.value === value);
  if (option) return { field: option.field, order: option.order };
  const [field, order] = value.split(':');
  return { field: field || DEFAULT_SORT.field, order: order === 'asc' ? 'asc' : 'desc' };
}

export function sortDuplicates(reviews, sortValue) {
  const items = [...reviews];
  const [field, order] = sortValue.split(':');
  const dir = order === 'desc' ? -1 : 1;

  items.sort((a, b) => {
    let left = '';
    let right = '';
    if (field === 'company') {
      left = a.existingLead?.company ?? '';
      right = b.existingLead?.company ?? '';
    } else if (field === 'reason') {
      left = a.matchReason ?? '';
      right = b.matchReason ?? '';
    } else {
      left = a.existingLead?.name ?? '';
      right = b.existingLead?.name ?? '';
    }
    return left.localeCompare(right, undefined, { sensitivity: 'base' }) * dir;
  });

  return items;
}
