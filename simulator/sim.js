// Fake ankle bands + bed units speaking exactly the protocol in docs/PROTOCOL.md.
//
//   node sim.js                               # 6 normal beds
//   node sim.js --beds 8 --scenario B02:desat,B03:exit,B04:fall,B05:fever,B06:badsignal
//   node sim.js --url mqtt://192.168.1.10:1883
//
// Scenarios: normal, desat, fever, tachy, hypotension, exit, fall, badsignal, still, call, offline
import mqtt from 'mqtt';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const url = args.url ?? 'mqtt://localhost:1883';
const nBeds = Number(args.beds ?? 6);
const scenarios = Object.fromEntries((args.scenario ?? '').split(',').filter(Boolean).map((p) => p.split(':')));

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ramp = (t, start, dur) => clamp((t - start) / dur, 0, 1); // 0..1 between start and start+dur (s)

function makeBed(bedId) {
  const scenario = scenarios[bedId] ?? 'normal';
  const base = { hr: rnd(64, 84), spo2: rnd(96, 99), temp: rnd(36.4, 37.0), sys: rnd(112, 132), side: rnd(-0.1, 0.1) };
  const t0 = Date.now();

  const conns = {};
  for (const node of ['ankle', 'bed']) {
    const c = mqtt.connect(url, {
      clientId: `sim-${bedId}-${node}`,
      will: { topic: `smartbed/${bedId}/${node}/status`, payload: JSON.stringify({ online: false }), qos: 1, retain: true },
    });
    c.on('connect', () => {
      c.publish(`smartbed/${bedId}/${node}/status`, JSON.stringify({ online: true, fw: 'sim-0.1', rssi: -55, battery: 87 }), { qos: 1, retain: true });
      c.subscribe(`smartbed/${bedId}/${node}/cmd`);
    });
    c.on('message', (_t, buf) => {
      const { cmd } = JSON.parse(buf);
      console.log(`[${bedId}/${node}] cmd ${cmd}`);
      if (cmd === 'bp_measure') setTimeout(sendBp, 3000); // a cuff takes a few seconds
    });
    conns[node] = c;
  }

  const sendBp = () => {
    const t = (Date.now() - t0) / 1000;
    const drop = scenario === 'hypotension' ? 35 * ramp(t, 10, 40) : 0;
    const sys = Math.round(base.sys - drop + rnd(-4, 4));
    conns.ankle.publish(`smartbed/${bedId}/ankle/bp`, JSON.stringify({ ts: Date.now(), sys, dia: Math.round(sys * 0.62) }), { qos: 1 });
  };
  setTimeout(sendBp, 2000);

  let exited = false, fallSent = false, callSent = false;

  const tick = () => {
    const t = (Date.now() - t0) / 1000;
    if (scenario === 'offline' && t > 20) { conns.ankle.end(true); conns.bed.end(true); return; }

    // ---- ankle vitals ----
    let { hr, spo2, temp } = base;
    let sqi = rnd(80, 98), motion = rnd(0, 0.05);
    if (scenario === 'desat') { spo2 -= 12 * ramp(t, 10, 30); hr += 25 * ramp(t, 10, 30); }
    if (scenario === 'fever') { temp += 2.6 * ramp(t, 5, 60); hr += 30 * ramp(t, 5, 60); }
    if (scenario === 'tachy') hr += 60 * ramp(t, 5, 20);
    if (scenario === 'hypotension') hr += 35 * ramp(t, 10, 40);
    if (scenario === 'badsignal' && t > 10) { sqi = rnd(10, 40); motion = rnd(0.3, 0.8); }
    if (scenario === 'exit' || scenario === 'fall') motion = t > 15 ? rnd(0.2, 0.6) : motion;
    conns.ankle.publish(`smartbed/${bedId}/ankle/vitals`, JSON.stringify({
      ts: Date.now(),
      hr: Math.round(hr + rnd(-2, 2)),
      spo2: Math.round(clamp(spo2 + rnd(-0.6, 0.6), 0, 100)),
      temp: +(temp + rnd(-0.05, 0.05)).toFixed(2),
      pi: +rnd(1.5, 4).toFixed(1),
      sqi: Math.round(sqi),
      motion: +motion.toFixed(2),
    }));

    // ---- bed pressure grid (4 rows head->foot × 8 cols left->right) ----
    let side = base.side, angle = 10, present = true, footShift = 0;
    if (scenario === 'exit' || scenario === 'fall') {
      side = base.side + 0.9 * ramp(t, 15, 15);     // shuffle to the right edge
      angle = 10 + 35 * ramp(t, 12, 8);             // sit up
      footShift = ramp(t, 20, 10);
      if (t > 35) present = false;
    }
    if (scenario === 'still') side = base.side;     // never moves -> pressure injury
    else if (scenario === 'normal' && Math.floor(t / 90) % 2) side = -base.side - 0.15; // turns now and then

    const grid = [0, 1, 2, 3].map((r) => [0, 1, 2, 3, 4, 5, 6, 7].map((c) => {
      if (!present) return Math.round(rnd(0, 20));
      const x = (c + 0.5) / 8 * 2 - 1;
      const bodyW = r === 1 || r === 2 ? 0.55 : 0.4; // hips/torso wider
      const weight = [0.8, 1, 1, 0.6][r] * (r >= 2 ? 1 + footShift * 0.6 : 1 - footShift * 0.3);
      const d = Math.abs(x - side) / bodyW;
      return Math.round(clamp(900 * weight * Math.exp(-d * d * 2) + rnd(0, 25), 0, 1023));
    }));
    conns.bed.publish(`smartbed/${bedId}/bed/state`, JSON.stringify({ ts: Date.now(), angle: +angle.toFixed(1), grid }));

    // ---- events ----
    if (scenario === 'fall' && t > 38 && !fallSent) {
      fallSent = true;
      conns.ankle.publish(`smartbed/${bedId}/ankle/event`, JSON.stringify({ ts: Date.now(), type: 'impact', g: 3.8 }), { qos: 1 });
    }
    if (scenario === 'call' && t > 8 && !callSent) {
      callSent = true;
      conns.bed.publish(`smartbed/${bedId}/bed/event`, JSON.stringify({ ts: Date.now(), type: 'nurse_call' }), { qos: 1 });
    }
    if (!present && !exited) { exited = true; console.log(`[${bedId}] patient left bed`); }
  };
  setInterval(tick, 1000);
  console.log(`${bedId}: ${scenario}`);
}

for (let i = 1; i <= nBeds; i++) makeBed(`B${String(i).padStart(2, '0')}`);
