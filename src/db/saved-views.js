import { toIsoOrNull } from './dates.js';
import { getSql } from './index.js';

export async function listSavedViews() {
  const sql = getSql();
  const rows = await sql`
    SELECT id, name, filter_json, created_at, updated_at
    FROM saved_views
    ORDER BY updated_at DESC
  `;
  return rows.map(rowToView);
}

export async function getSavedView(id) {
  const sql = getSql();
  const [row] = await sql`SELECT * FROM saved_views WHERE id = ${id}`;
  return row ? rowToView(row) : null;
}

export async function createSavedView({ name, filterJson }) {
  const now = new Date().toISOString();
  const sql = getSql();
  const [row] = await sql`
    INSERT INTO saved_views (name, filter_json, created_at, updated_at)
    VALUES (${name}, ${sql.json(filterJson)}, ${now}, ${now})
    RETURNING id
  `;
  return getSavedView(Number(row.id));
}

export async function deleteSavedView(id) {
  const sql = getSql();
  const rows = await sql`DELETE FROM saved_views WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

function rowToView(row) {
  let filterJson = row.filter_json ?? {};
  if (typeof filterJson === 'string') {
    try {
      filterJson = JSON.parse(filterJson);
    } catch {
      filterJson = {};
    }
  }
  return {
    id: Number(row.id),
    name: row.name,
    filterJson,
    createdAt: toIsoOrNull(row.created_at),
    updatedAt: toIsoOrNull(row.updated_at),
  };
}
