/**
 * A fixed piece of arithmetic, timed beside whatever a gate measures, so a baseline written on one
 * machine means something on another, or on the same one with something else running: it goes faster
 * and slower with the machine much as the physics, the terrain and the nav do. The gates hold a figure
 * to its baseline as a multiple of this, and report the milliseconds as well.
 *
 * It is plain typed-array arithmetic with no imports, so the smoke tests can send it to the page as it
 * is (`reference.toString()`) and time the same work in the browser.
 */

/**
 * Typed-array arithmetic of the physics' own kind, a pass of springs over a grid of points, the same
 * work every time. The milliseconds it takes.
 */
export function reference(): number {
  const n = 200_000;
  const x = new Float32Array(n),
    v = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sin(i * 0.37) * 3;
  const t = performance.now();
  for (let pass = 0; pass < 40; pass++) {
    for (let i = 1; i < n - 1; i++) {
      const f = x[i - 1] + x[i + 1] - 2 * x[i];
      v[i] = v[i] * 0.99 + f * 0.1;
    }
    for (let i = 0; i < n; i++) x[i] += Math.sqrt(v[i] * v[i] + 1e-6) * Math.sign(v[i]) * 0.01;
  }
  return performance.now() - t;
}
