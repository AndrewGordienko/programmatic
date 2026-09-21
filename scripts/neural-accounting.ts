import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { dreamDataset } from "../src/joint/dreams";
const folder = "output/joint/neural-v2",
  out = `${folder}/data-accounting.json`;
if (existsSync(out)) throw new Error("Preserve audit");
const bytes = readFileSync(`${folder}/data.json.gz`),
  stored = JSON.parse(gunzipSync(bytes).toString());
const corpus = JSON.parse(
  readFileSync("output/joint/inverse-corpus-v5.json", "utf8"),
);
const started = performance.now();
const replay = dreamDataset(
  corpus.corpus,
  stored.library,
  stored.seed,
  stored.requested,
  { commutative: true, lowerIntegerLiterals: true },
);
const hash = (x: unknown) =>
  createHash("sha256").update(JSON.stringify(x)).digest("hex");
for (const field of ["programs", "decisions", "semantics"] as const)
  if (hash(replay[field]) !== hash(stored[field]))
    throw new Error(`Replay mismatch: ${field}`);
writeFileSync(
  out,
  JSON.stringify(
    {
      artifactSha256: createHash("sha256").update(bytes).digest("hex"),
      verifiedFields: ["programs", "decisions", "semantics"],
      accounting: replay.accounting,
      auditReplayMs: performance.now() - started,
      note: "Deterministic replay adds counters to the existing dataset without changing examples, decisions, weights or its artifact bytes. These heterogeneous probe/training operations are separate from synthesis evaluations.",
    },
    null,
    2,
  ),
);
console.log(replay.accounting);
