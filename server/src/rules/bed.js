// Derived bed metrics from the 4x8 pressure grid: total load, occupancy and
// centre of pressure (CoP). x is lateral (-1 left edge .. +1 right edge),
// y is longitudinal (0 head .. 1 foot).
export function analyseGrid(grid, cfg) {
  let load = 0, sx = 0, sy = 0;
  const rows = grid.length, cols = grid[0].length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = grid[r][c];
      load += v;
      sx += v * ((c + 0.5) / cols * 2 - 1);
      sy += v * ((r + 0.5) / rows);
    }
  }
  const occupied = load >= cfg.occupiedLoad;
  const cop = load > 0 ? { x: sx / load, y: sy / load } : { x: 0, y: 0.5 };
  return { load, occupied, cop };
}

// Bed-exit prediction: a patient about to leave the bed typically sits up
// (high backrest or load concentrated toward hips) and shifts weight to one edge.
// Score 0..1; >= 0.6 raises a warning before the patient is actually out.
export function exitRisk(bed, cfg) {
  if (!bed.occupied) return 0;
  const edge = Math.min(1, Math.abs(bed.cop.x) / cfg.exitEdgeRatio);  // 1 when at the edge
  const sitting = Math.min(1, Math.max(0, (bed.angle ?? 0) / cfg.exitRiskAngle));
  const footward = Math.min(1, Math.max(0, (bed.cop.y - 0.5) / 0.25));
  return +(0.55 * edge + 0.25 * sitting + 0.2 * footward).toFixed(2);
}

// Pressure-injury tracking: accumulate continuous loaded minutes per cell.
// A cell resets when it is offloaded (patient turned).
export function updatePressure(pressure, grid, dtMs, cfg) {
  const dtMin = (dtMs / 60_000) * cfg.timeScale;
  let max = 0;
  const cells = grid.map((row, r) => row.map((v, c) => {
    const prev = pressure?.cells?.[r]?.[c] ?? 0;
    const next = v >= cfg.cellLoadedThreshold ? prev + dtMin : 0;
    if (next > max) max = next;
    return next;
  }));
  return { cells, maxMinutes: +max.toFixed(1) };
}
