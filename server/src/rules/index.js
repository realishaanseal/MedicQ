// Rules engine: given the live state of one bed, return the set of conditions
// that are currently true. The AlertManager turns those into alerts with
// persistence (debounce), dedupe and clearing.
//
// Each condition: { code, severity: 'crit'|'warn'|'info'|'tech', message, immediate? }

const fmt = (v, d = 0) => (v == null ? '—' : Number(v).toFixed(d));

function vitalConditions(s, cfg) {
  const out = [];
  const v = s.vitals;
  if (!v || !s.vitalsReliable) return out;
  const t = cfg.thresholds;

  if (v.spo2 != null) {
    if (v.spo2 < t.spo2.critLow) out.push({ code: 'SPO2_CRIT', severity: 'crit', message: `SpO₂ ${fmt(v.spo2)}% (< ${t.spo2.critLow})` });
    else if (v.spo2 < t.spo2.warnLow) out.push({ code: 'SPO2_LOW', severity: 'warn', message: `SpO₂ ${fmt(v.spo2)}% (< ${t.spo2.warnLow})` });
  }
  if (v.hr != null) {
    if (v.hr < t.hr.critLow || v.hr > t.hr.critHigh) out.push({ code: 'HR_CRIT', severity: 'crit', message: `HR ${fmt(v.hr)} bpm` });
    else if (v.hr < t.hr.warnLow || v.hr > t.hr.warnHigh) out.push({ code: 'HR_ABN', severity: 'warn', message: `HR ${fmt(v.hr)} bpm` });
  }
  if (v.temp != null) {
    if (v.temp >= t.temp.critHigh || v.temp <= t.temp.critLow) out.push({ code: 'TEMP_CRIT', severity: 'crit', message: `Temp ${fmt(v.temp, 1)} °C` });
    else if (v.temp >= t.temp.warnHigh) out.push({ code: 'TEMP_HIGH', severity: 'warn', message: `Temp ${fmt(v.temp, 1)} °C` });
  }
  return out;
}

function bpConditions(s, cfg) {
  const bp = s.bp;
  const t = cfg.thresholds.sys;
  if (!bp) return [];
  const msg = `BP ${fmt(bp.sys)}/${fmt(bp.dia)} mmHg`;
  // BP is a spot measurement, so alarm immediately rather than waiting for persistence.
  if (bp.sys <= t.critLow || bp.sys >= t.critHigh) return [{ code: 'BP_CRIT', severity: 'crit', message: msg, immediate: true }];
  if (bp.sys <= t.warnLow || bp.sys >= t.warnHigh) return [{ code: 'BP_ABN', severity: 'warn', message: msg, immediate: true }];
  return [];
}

function scoreConditions(s) {
  const n = s.news2;
  if (!n) return [];
  if (n.risk === 'high') return [{ code: 'NEWS2_HIGH', severity: 'crit', message: `NEWS2 (partial) ${n.score} — urgent review` }];
  if (n.risk === 'medium') return [{ code: 'NEWS2_MED', severity: 'warn', message: `NEWS2 (partial) ${n.score} — urgent ward review` }];
  return [];
}

function bedConditions(s, cfg, now) {
  const out = [];
  const b = s.bed;
  if (!b) return out;
  if (b.occupied && s.exitRisk >= 0.6) out.push({ code: 'EXIT_RISK', severity: 'warn', message: `Bed-exit risk ${Math.round(s.exitRisk * 100)}%` });
  // Only alarm for an exit if the bed was previously occupied for a while (avoids noise on admission).
  if (!b.occupied && s.wasOccupiedFor >= 30_000) out.push({ code: 'BED_EXIT', severity: 'crit', message: 'Patient out of bed', immediate: true });
  if (s.pressure && s.pressure.maxMinutes >= cfg.repositionAfterMin) {
    out.push({ code: 'REPOSITION', severity: 'warn', message: `Reposition due — ${Math.round(s.pressure.maxMinutes)} min continuous load`, immediate: true });
  }
  if (s.nurseCall) out.push({ code: 'NURSE_CALL', severity: 'info', message: 'Nurse call', immediate: true, sticky: true });

  // Fall: ankle impact while the bed is empty (within the window either side).
  // Sticky: stays until a nurse acknowledges it, even if the patient gets back in bed.
  if (s.lastImpact && now - s.lastImpact.at <= cfg.fallWindowMs && !b.occupied) {
    out.push({ code: 'FALL', severity: 'crit', message: `Possible fall (impact ${fmt(s.lastImpact.g, 1)} g)`, immediate: true, sticky: true });
  }
  return out;
}

function techConditions(s, cfg, now) {
  const out = [];
  for (const [node, d] of Object.entries(s.devices)) {
    if (d.online === false) out.push({ code: `OFFLINE_${node.toUpperCase()}`, severity: 'tech', message: `${node} device offline`, immediate: true });
    else if (d.lastSeen && now - d.lastSeen > cfg.staleMs) out.push({ code: `STALE_${node.toUpperCase()}`, severity: 'tech', message: `No data from ${node} for ${Math.round((now - d.lastSeen) / 1000)} s`, immediate: true });
    if (d.battery != null && d.battery < 15) out.push({ code: `BATT_${node.toUpperCase()}`, severity: 'tech', message: `${node} battery ${d.battery}%`, immediate: true });
  }
  if (s.poorSignalSince && now - s.poorSignalSince >= cfg.poorSignalAlertMs) {
    out.push({ code: 'POOR_SIGNAL', severity: 'tech', message: 'Ankle sensor poor signal — check placement', immediate: true });
  }
  return out;
}

export function evaluate(state, cfg, now = Date.now()) {
  return [
    ...vitalConditions(state, cfg),
    ...bpConditions(state, cfg),
    ...scoreConditions(state),
    ...bedConditions(state, cfg, now),
    ...techConditions(state, cfg, now),
  ];
}
