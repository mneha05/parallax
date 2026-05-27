// Self-contained statistical primitives. No external deps.
// References:
//   - Numerical Recipes 3e (incomplete gamma / beta)
//   - Press et al. for the Kolmogorov distribution series
//   - Birnbaum-Saunders / Cramér for Weibull MLE intuition

export function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function variance(xs: number[], unbiased = true): number {
  const n = xs.length;
  if (n < 2) return NaN;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return s / (unbiased ? n - 1 : n);
}

export function std(xs: number[], unbiased = true): number {
  return Math.sqrt(variance(xs, unbiased));
}

export function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return NaN;
  return n % 2 ? sorted[(n - 1) / 2] : 0.5 * (sorted[n / 2 - 1] + sorted[n / 2]);
}

// ─── Special functions ─────────────────────────────────────────────────────
// Lanczos log-gamma. Accurate to ~15 digits.
export function logGamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993,
    676.5203681218851,
    -1259.1392167224028,
    771.32342877765313,
    -176.61502916214059,
    12.507343278686905,
    -0.13857109526572012,
    9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

// Regularized lower incomplete gamma P(s, x) via series / continued fraction.
function gammaP(s: number, x: number): number {
  if (x < 0 || s <= 0) return NaN;
  if (x === 0) return 0;
  if (x < s + 1) {
    // Series representation
    let ap = s;
    let sum = 1 / s;
    let del = sum;
    for (let n = 1; n < 200; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-12) break;
    }
    return sum * Math.exp(-x + s * Math.log(x) - logGamma(s));
  }
  // Continued fraction Q, then P = 1 - Q
  let b = x + 1 - s;
  let c2 = 1 / 1e-30;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 200; i++) {
    const an = -i * (i - s);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c2 = b + an / c2;
    if (Math.abs(c2) < 1e-30) c2 = 1e-30;
    d = 1 / d;
    const delta = d * c2;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-12) break;
  }
  const q = Math.exp(-x + s * Math.log(x) - logGamma(s)) * h;
  return 1 - q;
}

// Regularized incomplete beta I_x(a,b). Numerical Recipes style.
function betaI(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const bt = Math.exp(-lbeta + a * Math.log(x) + b * Math.log(1 - x));
  // Lentz continued fraction
  const cf = (a: number, b: number, x: number) => {
    const MAXIT = 200, EPS = 3e-12, FPMIN = 1e-30;
    const qab = a + b, qap = a + 1, qam = a - 1;
    let c2 = 1, d = 1 - (qab * x) / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= MAXIT; m++) {
      const m2 = 2 * m;
      let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c2 = 1 + aa / c2;
      if (Math.abs(c2) < FPMIN) c2 = FPMIN;
      d = 1 / d;
      h *= d * c2;
      aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
      d = 1 + aa * d;
      if (Math.abs(d) < FPMIN) d = FPMIN;
      c2 = 1 + aa / c2;
      if (Math.abs(c2) < FPMIN) c2 = FPMIN;
      d = 1 / d;
      const del = d * c2;
      h *= del;
      if (Math.abs(del - 1) < EPS) return h;
    }
    return h;
  };
  if (x < (a + 1) / (a + b + 2)) return (bt * cf(a, b, x)) / a;
  return 1 - (bt * cf(b, a, 1 - x)) / b;
}

// Two-tailed p-value for a t-statistic with df.
export function tDistP2(t: number, df: number): number {
  // P(T > |t|) = 0.5 * I_x(df/2, 1/2) with x = df / (df + t^2)
  const x = df / (df + t * t);
  const p1 = 0.5 * betaI(df / 2, 0.5, x);
  return 2 * p1;
}

// Standard normal CDF
export function normalCDF(z: number): number {
  // Abramowitz & Stegun 26.2.17 approximation, max error 7.5e-8
  const a1 =  0.254829592, a2 = -0.284496736, a3 =  1.421413741;
  const a4 = -1.453152027, a5 =  1.061405429, p = 0.3275911;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

// Kolmogorov distribution: P(K > x) for two-sample KS
// Asymptotic series; good for moderate-large samples.
export function ksQ(lambda: number): number {
  if (lambda < 0.18) return 1;
  const EPS = 1e-10;
  let s = 0;
  let prev = 0;
  let sign = 1;
  for (let j = 1; j <= 150; j++) {
    const term = sign * Math.exp(-2 * j * j * lambda * lambda);
    s += term;
    if (Math.abs(term) <= EPS * Math.abs(prev) || Math.abs(term) <= EPS * s) break;
    prev = term;
    sign *= -1;
  }
  return Math.max(0, Math.min(1, 2 * s));
}

// Pearson correlation
export function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    const a = xs[i] - mx, b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  return num / Math.sqrt(dx * dy);
}

// Rank vector with average ties (used for Spearman + Mann-Whitney)
export function ranks(xs: number[]): number[] {
  const indexed = xs.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const out = new Array<number>(xs.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
    const avgRank = (i + j) / 2 + 1; // 1-indexed
    for (let k = i; k <= j; k++) out[indexed[k].i] = avgRank;
    i = j + 1;
  }
  return out;
}

export function spearman(xs: number[], ys: number[]): number {
  return pearson(ranks(xs), ranks(ys));
}
