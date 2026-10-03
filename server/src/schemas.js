import { z } from 'zod';

const ts = z.number().nonnegative().default(0);

export const schemas = {
  'ankle/vitals': z.object({
    ts,
    hr: z.number().min(0).max(300).nullable(),
    spo2: z.number().min(0).max(100).nullable(),
    temp: z.number().min(20).max(45).nullable(),
    pi: z.number().min(0).max(30).optional(),
    sqi: z.number().min(0).max(100),
    motion: z.number().min(0).max(1).default(0),
  }),
  'ankle/bp': z.object({
    ts,
    sys: z.number().min(40).max(300),
    dia: z.number().min(20).max(200),
  }),
  'ankle/event': z.object({ ts, type: z.enum(['impact']), g: z.number() }),
  'bed/state': z.object({
    ts,
    angle: z.number().min(-10).max(90),
    grid: z.array(z.array(z.number().min(0).max(4095)).length(8)).length(4),
  }),
  'bed/event': z.object({ ts, type: z.enum(['nurse_call']) }),
  status: z.object({
    online: z.boolean(),
    fw: z.string().optional(),
    rssi: z.number().optional(),
    battery: z.number().min(0).max(100).optional(),
  }),
};

// smartbed/B01/ankle/vitals -> { bedId: 'B01', node: 'ankle', kind: 'ankle/vitals' }
export function parseTopic(topic) {
  const m = /^smartbed\/([A-Za-z0-9_-]+)\/(ankle|bed)\/(vitals|bp|event|state|status)$/.exec(topic);
  if (!m) return null;
  const [, bedId, node, leaf] = m;
  return { bedId, node, kind: leaf === 'status' ? 'status' : `${node}/${leaf}` };
}
