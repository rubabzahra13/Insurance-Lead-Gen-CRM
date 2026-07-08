import { useMemo } from 'react';
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { colorAt, colorFillAt } from '../../lib/chart-theme.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  ArcElement,
  Filler,
  Tooltip,
);

const GRID = '#e2e8f0';
const TICK = '#64748b';
const TICK_LABEL = '#475569';
const ACCENT = '#0d9488';

const TOOLTIP = {
  backgroundColor: 'rgba(15, 23, 42, 0.92)',
  titleColor: '#f8fafc',
  bodyColor: '#cbd5e1',
  borderColor: 'rgba(148, 163, 184, 0.2)',
  borderWidth: 1,
  padding: 10,
  cornerRadius: 8,
  displayColors: true,
  boxPadding: 4,
};

function onChartClick(data, handler) {
  return (_event, elements) => {
    if (!handler || !elements?.length) return;
    const row = data[elements[0].index];
    if (row) handler(row);
  };
}

function pointerOnHover(onClick) {
  if (!onClick) return undefined;
  return (event, elements) => {
    event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
  };
}

function accentGradient(context) {
  const { chart } = context;
  const { ctx, chartArea } = chart;
  if (!chartArea) return 'rgba(13, 148, 136, 0.2)';
  const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  gradient.addColorStop(0, 'rgba(13, 148, 136, 0.3)');
  gradient.addColorStop(1, 'rgba(13, 148, 136, 0.02)');
  return gradient;
}

export function HBarChart({ data, onClick, height, name = 'Leads' }) {
  const h = height ?? Math.max(180, data.length * 34);

  const chartData = useMemo(
    () => ({
      labels: data.map((row) => row.label),
      datasets: [
        {
          label: name,
          data: data.map((row) => row.count),
          backgroundColor: data.map((row, i) => row.fill ?? colorAt(i)),
          borderRadius: 5,
          borderSkipped: false,
          barThickness: 22,
          maxBarThickness: 28,
        },
      ],
    }),
    [data, name],
  );

  const options = useMemo(
    () => ({
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      onClick: onChartClick(data, onClick),
      onHover: pointerOnHover(onClick),
      plugins: {
        legend: { display: false },
        tooltip: {
          ...TOOLTIP,
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${Number(ctx.parsed.x).toLocaleString()}`,
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: GRID, drawTicks: false },
          border: { display: false },
          ticks: { color: TICK, font: { size: 11 }, precision: 0 },
        },
        y: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: TICK_LABEL, font: { size: 10 }, autoSkip: false },
        },
      },
    }),
    [data, onClick, name],
  );

  return (
    <div className="chartjs-container" style={{ height: h }}>
      <Bar data={chartData} options={options} />
    </div>
  );
}

export function AreaTrendChart({ data, formatLabel }) {
  const chartData = useMemo(
    () => ({
      labels: data.map((row) => row.date),
      datasets: [
        {
          label: 'Leads',
          data: data.map((row) => row.count),
          borderColor: ACCENT,
          backgroundColor: accentGradient,
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: ACCENT,
          pointHoverBorderColor: '#ffffff',
          pointHoverBorderWidth: 2,
          borderWidth: 2,
        },
      ],
    }),
    [data],
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...TOOLTIP,
          callbacks: {
            title: (items) => (formatLabel ? formatLabel(items[0]?.label) : items[0]?.label),
            label: (ctx) => `Leads: ${Number(ctx.parsed.y).toLocaleString()}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: {
            color: TICK,
            font: { size: 11 },
            maxRotation: 0,
            callback(value) {
              const label = this.getLabelForValue(value);
              return formatLabel ? formatLabel(label) : label;
            },
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: GRID, drawTicks: false },
          border: { display: false },
          ticks: { color: TICK, font: { size: 11 }, precision: 0 },
        },
      },
    }),
    [formatLabel],
  );

  return (
    <div className="chartjs-container chartjs-container-trend">
      <Line data={chartData} options={options} />
    </div>
  );
}

export function MonthBarChart({ data }) {
  const chartData = useMemo(
    () => ({
      labels: data.map((row) => row.month),
      datasets: [
        {
          label: 'Leads',
          data: data.map((row) => row.count),
          backgroundColor: data.map((row, i) => (i % 2 === 0 ? colorFillAt(0) : colorFillAt(1))),
          borderColor: data.map((row, i) => (i % 2 === 0 ? colorAt(0) : colorAt(1))),
          borderWidth: 2,
          borderRadius: 4,
          borderSkipped: false,
          maxBarThickness: 40,
        },
      ],
    }),
    [data],
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...TOOLTIP,
          callbacks: {
            label: (ctx) => `Leads: ${Number(ctx.parsed.y).toLocaleString()}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: TICK, font: { size: 10 } },
        },
        y: {
          beginAtZero: true,
          grid: { color: GRID, drawTicks: false },
          border: { display: false },
          ticks: { color: TICK, font: { size: 11 }, precision: 0 },
        },
      },
    }),
    [],
  );

  return (
    <div className="chartjs-container chartjs-container-trend">
      <Bar data={chartData} options={options} />
    </div>
  );
}

export function DonutChart({
  data,
  onClick,
  innerRadius = 48,
  outerRadius = 78,
  cutout: cutoutProp,
  showLegend = false,
}) {
  const cutout =
    cutoutProp ??
    (innerRadius === 0 ? 0 : `${Math.round((innerRadius / outerRadius) * 100)}%`);

  const chartData = useMemo(
    () => ({
      labels: data.map((row) => row.label),
      datasets: [
        {
          data: data.map((row) => row.count),
          backgroundColor: data.map((row, i) => row.fill ?? colorFillAt(i)),
          borderColor: data.map((row, i) => row.border ?? row.stroke ?? colorAt(i)),
          borderWidth: 2,
          hoverOffset: 6,
        },
      ],
    }),
    [data],
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      cutout,
      onClick: onChartClick(data, onClick),
      onHover: pointerOnHover(onClick),
      layout: showLegend ? { padding: { top: 4, bottom: 4 } } : undefined,
      plugins: {
        legend: showLegend
          ? {
              display: true,
              position: 'top',
              align: 'center',
              labels: {
                boxWidth: 12,
                boxHeight: 12,
                padding: 10,
                font: { size: 11, weight: '500' },
                color: TICK_LABEL,
                usePointStyle: true,
                pointStyle: 'rectRounded',
                generateLabels(chart) {
                  const { labels = [], datasets = [] } = chart.data;
                  const borders = datasets[0]?.borderColor ?? [];
                  return labels.map((label, i) => ({
                    text: label,
                    fillStyle: borders[i] ?? colorAt(i),
                    strokeStyle: borders[i] ?? colorAt(i),
                    lineWidth: 2,
                    hidden: !chart.getDataVisibility(i),
                    index: i,
                  }));
                },
              },
              onClick: onClick
                ? (_event, legendItem) => {
                    const row = data[legendItem.index];
                    if (row) onClick(row);
                  }
                : undefined,
            }
          : { display: false },
        tooltip: {
          ...TOOLTIP,
          callbacks: {
            label: (ctx) => `${ctx.label}: ${Number(ctx.parsed).toLocaleString()}`,
          },
        },
      },
    }),
    [data, onClick, cutout, showLegend],
  );

  return (
    <div className={`chartjs-container chartjs-container-donut${showLegend ? ' chartjs-container-donut-legend' : ''}`}>
      <Doughnut data={chartData} options={options} />
    </div>
  );
}

export function DonutLegend({ data, onClick }) {
  return (
    <ul className="dash-donut-legend">
      {data.map((row, i) => (
        <li key={row.value}>
          <button type="button" className="dash-legend-item" onClick={() => onClick?.(row)}>
            <span className="dash-legend-dot" style={{ background: row.border ?? row.stroke ?? colorAt(i) }} />
            <span className="dash-legend-name">{row.label}</span>
            <span className="dash-legend-count">{row.count}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
