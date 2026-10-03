import { api } from '../live.js';

export const fmt = (v, d = 0) => (v == null ? '--' : Number(v).toFixed(d));

// Large numeric readout styled like a patient monitor parameter box.
export function Vital({ label, value, unit, color, dim, big, sub }) {
  return (
    <div className={`vital ${dim ? 'dim' : ''} ${big ? 'big' : ''}`} style={{ '--c': color }}>
      <div className="vital-label">{label}</div>
      <div className="vital-value">{value}<span className="vital-unit">{unit}</span></div>
      {sub && <div className="vital-sub">{sub}</div>}
    </div>
  );
}

export function Sparkline({ data, color, min, max, height = 40 }) {
  const pts = data.filter((d) => d != null);
  if (pts.length < 2) return <svg className="spark" height={height} />;
  const lo = min ?? Math.min(...pts), hi = max ?? Math.max(...pts);
  const span = hi - lo || 1;
  const d = data
    .map((v, i) => (v == null ? null : `${(i / (data.length - 1)) * 100},${height - ((v - lo) / span) * (height - 4) - 2}`))
    .filter(Boolean)
    .join(' ');
  return (
    <svg className="spark" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" height={height}>
      <polyline points={d} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// 4×8 pressure heatmap, head at top. Cells with long continuous load are outlined.
export function PressureMap({ bed, pressure, repositionAfterMin = 120 }) {
  if (!bed) return <div className="muted">No bed unit data</div>;
  return (
    <div className="pmap">
      {bed.grid.map((row, r) =>
        row.map((v, c) => {
          const mins = pressure?.cells?.[r]?.[c] ?? 0;
          const hot = mins >= repositionAfterMin * 0.75;
          return (
            <div
              key={`${r}-${c}`}
              className={`pcell ${hot ? 'hot' : ''}`}
              title={`${v} raw · ${Math.round(mins)} min loaded`}
              style={{ background: `hsl(${220 - (v / 1023) * 220} 80% ${12 + (v / 1023) * 40}%)` }}
            />
          );
        }),
      )}
      {bed.occupied && (
        <div className="cop" style={{ left: `${(bed.cop.x + 1) * 50}%`, top: `${bed.cop.y * 100}%` }} />
      )}
    </div>
  );
}

export function AlertRow({ a, showBed }) {
  const t = new Date(a.raised_at).toLocaleTimeString();
  return (
    <div className={`alert sev-${a.severity} ${a.cleared_at ? 'cleared' : ''} ${a.acked_at ? 'acked' : ''}`}>
      <span className="alert-time">{t}</span>
      {showBed && <a className="alert-bed" href={`#/bed/${a.bed_id}`}>{a.bed_id}</a>}
      <span className="alert-msg">{a.message}</span>
      {a.cleared_at && <span className="tag">cleared</span>}
      {a.acked_at ? <span className="tag">ack {a.acked_by}</span> : <button onClick={() => api.ack(a.id)}>Ack</button>}
    </div>
  );
}

export const worstSeverity = (alerts) => alerts.find((a) => !a.cleared_at)?.severity ?? null;
