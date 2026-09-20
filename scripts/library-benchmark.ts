import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { experiment } from "../src/dsl/experiment";
import { comparison, summarize } from "../src/dsl/metrics";
import { ARMS, DEFAULT, type Result } from "../src/dsl/types";

// Protocol frozen before these runs. All seeds retained, including regressions.
const single = process.argv.indexOf("--single");
const seeds =
  single >= 0
    ? [Number(process.argv[single + 1])]
    : process.argv.includes("--reference")
      ? [42]
      : [...Array.from({ length: 19 }, (_, i) => i), 42];
mkdirSync("output/library", { recursive: true });
const rows = [];
if (single < 0 && !process.argv.includes("--reference")) {
  const queue = seeds.filter(
    (seed) =>
      !process.argv.includes("--resume") ||
      !existsSync(`output/library/seed-${seed}.json`),
  );
  const jobs = Math.max(1, Math.min(4, Number(process.env.LIBRARY_JOBS) || 2));
  await Promise.all(
    Array.from({ length: jobs }, async () => {
      while (queue.length) {
        const seed = queue.shift()!;
        await new Promise<void>((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [
              "--import",
              "tsx",
              "scripts/library-benchmark.ts",
              "--single",
              String(seed),
            ],
            { stdio: ["ignore", "pipe", "pipe"] },
          );
          child.stdout.on("data", (data) => process.stdout.write(data));
          child.stderr.on("data", (data) => process.stderr.write(data));
          child.on("error", reject);
          child.on("exit", (code) =>
            code === 0
              ? resolve()
              : reject(new Error(`Seed ${seed} exited ${code}`)),
          );
        });
      }
    }),
  );
}
for (const seed of seeds) {
  const path = `output/library/seed-${seed}.json`;
  let result: Result;
  if (
    (process.argv.includes("--resume") ||
      (single < 0 && !process.argv.includes("--reference"))) &&
    existsSync(path)
  )
    result = JSON.parse(readFileSync(path, "utf8"));
  else {
    const iterator = experiment({ ...DEFAULT, seed });
    let next = iterator.next(),
      phase = "";
    while (!next.done) {
      const p = next.value.phase;
      if (
        p !== phase &&
        (p.includes("complete") ||
          p.includes("frozen") ||
          p.includes("full development"))
      ) {
        console.log(
          JSON.stringify({ seed, phase: p, elapsedMs: next.value.elapsedMs }),
        );
        phase = p;
      }
      next = iterator.next();
    }
    result = next.value;
    writeFileSync(path, JSON.stringify(result));
  }
  if (seed === 42)
    writeFileSync("public/library-reference.json", JSON.stringify(result));
  const row = {
    seed,
    config: result.config,
    comparison: comparison(result),
    arms: ARMS.map((arm) => summarize(result.trials, arm)),
    macros: result.macros.map((m) => m.definition),
    discoveryMs: result.discoveryMs,
    elapsedMs: result.elapsedMs,
  };
  rows.push(row);
  console.log(JSON.stringify(row));
  if (single < 0)
    writeFileSync(
      "public/library-benchmark.json",
      JSON.stringify({
        version: "library-search-v1",
        seeds,
        completed: rows.length,
        rows,
      }),
    );
}
