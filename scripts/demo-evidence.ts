import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { deriveEvidence } from "../src/demo/evidence";
const files = [
  "offroad-benchmark.json",
  "offroad-reference.json",
  "library-benchmark.json",
  "library-reference.json",
];
const raw = files.map((file) => readFileSync(`public/${file}`, "utf8"));
const data = raw.map((s) => JSON.parse(s));
const evidence = {
  ...deriveEvidence(data[0], data[1], data[2], data[3]),
  sources: files.map((file, i) => ({
    path: `/${file}`,
    sha256: createHash("sha256").update(raw[i]).digest("hex"),
  })),
};
writeFileSync(
  "public/demo-evidence.json",
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(
  "Presentation evidence derived from four recorded benchmark artifacts.",
);
