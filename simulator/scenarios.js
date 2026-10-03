// Transport-agnostic bed simulator. Used by sim.js (over MQTT) and by the
// dashboard's demo mode (in the browser, no server).
//
// createBedSim(bedId, scenario, send) where send(node, leaf, payload) publishes
// to smartbed/{bedId}/{node}/{leaf}. Call tick() once a second.
//
// Scenarios: normal, desat, fever, tachy, hypotension, exit, fall, badsignal, still, call, offline
export const SCENARIOS = ['normal', 'desat', 'fever', 'tachy', 'hypotension', 'exit', 'fall', 'badsignal', 'still', 'call', 'offline'];

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ramp = (t, start, dur) => clamp((t - start) / dur, 0, 1); // 0..1 between start and start+dur (s)

export function createBedSim(bedId, scenario = 'normal', send) {
  const base = { hr: rnd(64, 84), spo2: rnd(96, 99), temp: rnd(36.4, 37.0), sys: rnd(112, 132), side: rnd(-0.1, 0.1) };
  const t0 = Date.now();
  let fallSent = false, callSent = false, stopped = false;

  for (const node of ['ankle', 'bed']) send(node, 'status', { online: true, fw: 'sim-0.1', rssi: Math.round(rnd(-70, -45)), battery: Math.round(rnd(60, 95)) });

  const sendBp = () => {
    if (stopped) return;
    const t = (Date.now() - t0) / 1000;
    const drop = scenario === 'hypotension' ? 35 * ramp(t, 10, 40) : 0;
    const sys = Math.round(base.sys - drop + rnd(-4, 4));
    send('ankle', 'bp', { ts: Date.now(), sys, dia: Math.round(sys * 0.62) });
  };
  setTimeout(sendBp, 2000);

  // Device commands (downlink).
  const command = (node, cmd) => {
    if (node === 'ankle' && cmd === 'bp_measure') setTimeout(sendBp, 3000); // a cuff takes a few seconds
  };

  const tick = () => {
    if (stopped) return;
    const t = (Date.now() - t0) / 1000;
    if (scenario === 'offline' && t > 20) {
      // Emulates the broker publishing each device's Last Will.
      stopped = true;
      send('ankle', 'status', { online: false });
      send('bed', 'status', { online: false });
      return;
    }

    // ---- ankle vitals ----
    let { hr, spo2, temp } = base;
    let sqi = rnd(80, 98), motion = rnd(0, 0.05);
    if (scenario === 'desat') { spo2 -= 12 * ramp(t, 10, 30); hr += 25 * ramp(t, 10, 30); }
    if (scenario === 'fever') { temp += 2.6 * ramp(t, 5, 60); hr += 30 * ramp(t, 5, 60); }
    if (scenario === 'tachy') hr += 60 * ramp(t, 5, 20);
    if (scenario === 'hypotension') hr += 35 * ramp(t, 10, 40);
    if (scenario === 'badsignal' && t > 10) { sqi = rnd(10, 40); motion = rnd(0.3, 0.8); }
    if ((scenario === 'exit' || scenario === 'fall') && t > 15) motion = rnd(0.2, 0.6);
    send('ankle', 'vitals', {
      ts: Date.now(),
      hr: Math.round(hr + rnd(-2, 2)),
      spo2: Math.round(clamp(spo2 + rnd(-0.6, 0.6), 0, 100)),
      temp: +(temp + rnd(-0.05, 0.05)).toFixed(2),
      pi: +rnd(1.5, 4).toFixed(1),
      sqi: Math.round(sqi),
      motion: +motion.toFixed(2),
    });

    // ---- bed pressure grid (4 rows head->foot × 8 cols left->right) ----
    let side = base.side, angle = 10, present = true, footShift = 0;
    if (scenario === 'exit' || scenario === 'fall') {
      side = base.side + 0.9 * ramp(t, 15, 15);     // shuffle to the right edge
      angle = 10 + 35 * ramp(t, 12, 8);             // sit up
      footShift = ramp(t, 20, 10);
      if (t > 35) present = false;
    }
    if (scenario === 'normal' && Math.floor(t / 90) % 2) side = -base.side - 0.15; // turns now and then; 'still' never moves

    const grid = [0, 1, 2, 3].map((r) => [0, 1, 2, 3, 4, 5, 6, 7].map((c) => {
      if (!present) return Math.round(rnd(0, 20));
      const x = (c + 0.5) / 8 * 2 - 1;
      const bodyW = r === 1 || r === 2 ? 0.55 : 0.4; // hips/torso wider
      const weight = [0.8, 1, 1, 0.6][r] * (r >= 2 ? 1 + footShift * 0.6 : 1 - footShift * 0.3);
      const d = Math.abs(x - side) / bodyW;
      return Math.round(clamp(900 * weight * Math.exp(-d * d * 2) + rnd(0, 25), 0, 1023));
    }));
    send('bed', 'state', { ts: Date.now(), angle: +angle.toFixed(1), grid });

    // ---- events ----
    if (scenario === 'fall' && t > 38 && !fallSent) {
      fallSent = true;
      send('ankle', 'event', { ts: Date.now(), type: 'impact', g: 3.8 });
    }
    if (scenario === 'call' && t > 8 && !callSent) {
      callSent = true;
      send('bed', 'event', { ts: Date.now(), type: 'nurse_call' });
    }
  };

  return { bedId, scenario, tick, command, get stopped() { return stopped; } };
}
