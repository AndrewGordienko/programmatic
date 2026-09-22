/** Fixed bounded coefficient space; no task programs or concepts are used. */
export const affineGrid = [
  0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 8, -8,
];
export type Slope = { alpha: number; beta: number };
export const gridSlopes: Slope[] = affineGrid.flatMap((alpha) =>
  affineGrid.map((beta) => ({ alpha, beta })),
);
export const simpleSlopes: Slope[] = [...gridSlopes].sort(
  (a, b) =>
    Math.abs(a.alpha) + Math.abs(a.beta) - Math.abs(b.alpha) - Math.abs(b.beta),
);

/** Two exact observations imply dx*alpha + dy*beta = dz. Enumerate one
 * coefficient and derive the other, charging every attempted derivation.
 * The caller still checks every observation and executes the emitted tree. */
export function constrainedSlopes(
  dx: number,
  dy: number,
  dz: number,
  charge: () => boolean,
): Slope[] {
  const rows: Slope[] = [];
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 1e-9) return rows;
  for (const free of affineGrid) {
    if (!charge()) break;
    const raw =
      Math.abs(dy) >= Math.abs(dx)
        ? (dz - dx * free) / dy
        : (dz - dy * free) / dx;
    const fixed = Math.round(raw);
    if (Math.abs(raw - fixed) > 1e-6 || Math.abs(fixed) > 8) continue;
    rows.push(
      Math.abs(dy) >= Math.abs(dx)
        ? { alpha: free, beta: fixed }
        : { alpha: fixed, beta: free },
    );
  }
  return rows.sort(
    (a, b) =>
      Math.abs(a.alpha) +
        Math.abs(a.beta) -
        Math.abs(b.alpha) -
        Math.abs(b.beta) ||
      affineGrid.indexOf(a.alpha) - affineGrid.indexOf(b.alpha) ||
      affineGrid.indexOf(a.beta) - affineGrid.indexOf(b.beta),
  );
}
