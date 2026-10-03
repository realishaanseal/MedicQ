// Fake ankle bands + bed units speaking exactly the protocol in docs/PROTOCOL.md.
//
//   node sim.js                               # 6 normal beds
//   node sim.js --beds 8 --scenario B02:desat,B03:exit,B04:fall,B05:fever,B06:badsignal
//   node sim.js --url mqtt://192.168.1.10:1883
//
// Scenarios are defined in scenarios.js.
import mqtt from 'mqtt';
import { createBedSim } from './scenarios.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const url = args.url ?? 'mqtt://localhost:1883';
const nBeds = Number(args.beds ?? 6);
const scenarios = Object.fromEntries((args.scenario ?? '').split(',').filter(Boolean).map((p) => p.split(':')));

const RELIABLE = new Set(['bp', 'event', 'status']); // QoS 1, matching the protocol table

function startBed(bedId) {
  const scenario = scenarios[bedId] ?? 'normal';
  const conns = {};
  let sim;

  for (const node of ['ankle', 'bed']) {
    const c = mqtt.connect(url, {
      clientId: `sim-${bedId}-${node}`,
      will: { topic: `smartbed/${bedId}/${node}/status`, payload: JSON.stringify({ online: false }), qos: 1, retain: true },
    });
    c.on('connect', () => c.subscribe(`smartbed/${bedId}/${node}/cmd`));
    c.on('message', (_t, buf) => {
      const { cmd } = JSON.parse(buf);
      console.log(`[${bedId}/${node}] cmd ${cmd}`);
      sim?.command(node, cmd);
    });
    conns[node] = c;
  }

  const send = (node, leaf, payload) =>
    conns[node].publish(`smartbed/${bedId}/${node}/${leaf}`, JSON.stringify(payload), {
      qos: RELIABLE.has(leaf) ? 1 : 0,
      retain: leaf === 'status',
    });

  sim = createBedSim(bedId, scenario, send);
  const timer = setInterval(() => {
    sim.tick();
    if (sim.stopped) {
      clearInterval(timer);
      conns.ankle.end(true);
      conns.bed.end(true);
    }
  }, 1000);
  console.log(`${bedId}: ${scenario}`);
}

for (let i = 1; i <= nBeds; i++) startBed(`B${String(i).padStart(2, '0')}`);
