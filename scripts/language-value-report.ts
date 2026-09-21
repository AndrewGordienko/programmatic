import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import {
  predictLanguageValue,
  type LanguageValueModel,
} from "../src/joint/language-value";
import { Random } from "../src/engine/random";
import type { Genome } from "../src/joint/genome";
const folder = "output/joint/language-value-v1",
  out = `${folder}/ranking.json`;
if (existsSync(out)) throw new Error("Preserve held-out ranking");
const bytes = readFileSync(`${folder}/model.json`),
  model: LanguageValueModel = JSON.parse(bytes.toString());
for (const fixture of JSON.parse(readFileSync(`${folder}/parity.json`, "utf8")))
  assert.ok(
    Math.abs(predictLanguageValue(model, fixture.features) - fixture.value) <
      1e-10,
  );
type Row = {
  seed: number;
  round: number;
  stage: string;
  split: string;
  x: number[];
  y: number;
  genome: Genome;
};
const data: { rows: Row[] } = JSON.parse(
  gunzipSync(readFileSync(`${folder}/data.json.gz`)).toString(),
);
const groups = new Map<string, Row[]>();
for (const row of data.rows.filter((r) => r.split === "test")) {
  const k = `${row.seed}-${row.round}-${row.stage}`;
  groups.set(k, [...(groups.get(k) ?? []), row]);
}
const rng = new Random(192081),
  mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
const comparisons = [...groups].map(([batch, rows]) => {
  const oracle = Math.max(...rows.map((r) => r.y));
  const value = [...rows].sort(
    (a, b) =>
      predictLanguageValue(model, b.x) - predictLanguageValue(model, a.x),
  );
  const proxy = (r: Row) =>
    r.genome.macros.reduce((s, m) => s + m.support * (m.size - m.arity - 1), 0);
  const compression = [...rows].sort((a, b) => proxy(b) - proxy(a));
  return {
    batch,
    candidates: rows.length,
    oracle,
    top: [1, 5, 10, 32].map((k) => {
      const count = Math.min(k, rows.length),
        best = (xs: Row[]) => Math.max(...xs.slice(0, count).map((r) => r.y));
      const random = Array.from({ length: 1000 }, () => {
        const available = [...rows];
        for (let i = 0; i < count; i++) {
          const j = i + rng.int(available.length - i);
          [available[i], available[j]] = [available[j], available[i]];
        }
        return best(available);
      });
      return {
        k: count,
        valueRegret: oracle - best(value),
        compressionProxyRegret: oracle - best(compression),
        randomRegret: oracle - mean(random),
        valueChosen: value.slice(0, count).map((r) => r.genome.id),
      };
    }),
  };
});
writeFileSync(
  out,
  JSON.stringify(
    {
      modelHash: createHash("sha256").update(bytes).digest("hex"),
      comparisons,
      note: "Held-out meta-seed ranking over labels already measured by exhaustive races. Screen pools are complete generated populations; medium pools were previously selected and are selection-biased. Compression is a support×body-size proxy, not exact refactoring savings. Saved compute is zero in this retrospective experiment. Freeze this model before a separate prospective selection comparison.",
    },
    null,
    2,
  ),
);
console.log(
  comparisons
    .filter((c) => c.batch.endsWith("screen"))
    .map((c) => ({ batch: c.batch, top10: c.top.find((r) => r.k === 10) })),
);
