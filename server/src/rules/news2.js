// NEWS2 (Royal College of Physicians, 2017), SpO2 scale 1.
// The ankle band does not measure respiratory rate, consciousness (ACVPU) or
// supplemental O2, so the score is a PARTIAL NEWS2 and is labelled as such.

const band = (v, table) => {
  for (const [test, pts] of table) if (test(v)) return pts;
  return 0;
};

export const news2Parts = {
  spo2: (v) => band(v, [[(x) => x <= 91, 3], [(x) => x <= 93, 2], [(x) => x <= 95, 1]]),
  temp: (v) => band(v, [[(x) => x <= 35.0, 3], [(x) => x <= 36.0, 1], [(x) => x <= 38.0, 0], [(x) => x <= 39.0, 1], [() => true, 2]]),
  sys: (v) => band(v, [[(x) => x <= 90, 3], [(x) => x <= 100, 2], [(x) => x <= 110, 1], [(x) => x <= 219, 0], [() => true, 3]]),
  hr: (v) => band(v, [[(x) => x <= 40, 3], [(x) => x <= 50, 1], [(x) => x <= 90, 0], [(x) => x <= 110, 1], [(x) => x <= 130, 2], [() => true, 3]]),
};

// values: { spo2, temp, sys, hr } — any may be null (unknown / unreliable)
export function news2(values) {
  const parts = {};
  let score = 0;
  let anyThree = false;
  for (const [k, fn] of Object.entries(news2Parts)) {
    if (values[k] == null) continue;
    parts[k] = fn(values[k]);
    score += parts[k];
    if (parts[k] === 3) anyThree = true;
  }
  const risk = score >= 7 ? 'high' : score >= 5 ? 'medium' : anyThree ? 'low-medium' : 'low';
  const missing = ['rr', 'acvpu', 'o2', ...Object.keys(news2Parts).filter((k) => values[k] == null)];
  return { score, risk, parts, partial: true, missing };
}
