/** Solid stroke + semi-transparent fill pairs (area / donut style). */
export const CHART_PALETTE = [
  { solid: '#0d9488', fill: 'rgba(13, 148, 136, 0.42)' },
  { solid: '#2dd4bf', fill: 'rgba(45, 212, 191, 0.45)' },
  { solid: '#6366f1', fill: 'rgba(99, 102, 241, 0.42)' },
  { solid: '#8b5cf6', fill: 'rgba(139, 92, 246, 0.42)' },
  { solid: '#eab308', fill: 'rgba(234, 179, 8, 0.42)' },
  { solid: '#f43f5e', fill: 'rgba(244, 63, 94, 0.42)' },
  { solid: '#0ea5e9', fill: 'rgba(14, 165, 233, 0.42)' },
  { solid: '#64748b', fill: 'rgba(100, 116, 139, 0.42)' },
];

/** @deprecated use paletteAt — kept for solid-only call sites */
export const CHART_COLORS = CHART_PALETTE.map((entry) => entry.solid);

export function paletteAt(index) {
  return CHART_PALETTE[index % CHART_PALETTE.length];
}

export function colorAt(index) {
  return paletteAt(index).solid;
}

export function colorFillAt(index) {
  return paletteAt(index).fill;
}

export function withPaletteColors(rows) {
  return rows.map((row, i) => {
    const { solid, fill } = paletteAt(i);
    return { ...row, fill, border: solid, stroke: solid };
  });
}
