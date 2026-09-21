import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { dreamDataset } from "../src/joint/dreams";
const folder = "output/joint/neural-v2";
if (existsSync(`${folder}/data.json.gz`))
  throw new Error("Preserve training dataset");
const corpus = JSON.parse(
  readFileSync("output/joint/inverse-corpus-v5.json", "utf8"),
);
const language = JSON.parse(
  readFileSync("output/joint/inverse-language-pilot-v3.json", "utf8"),
);
const start = performance.now();
const data = dreamDataset(
  corpus.corpus,
  language.candidate.macros,
  88121,
  10000,
  { commutative: true, lowerIntegerLiterals: true },
);
mkdirSync(folder, { recursive: true });
writeFileSync(`${folder}/data.json.gz`, gzipSync(JSON.stringify(data)));
writeFileSync(
  `${folder}/data-manifest.json`,
  JSON.stringify(
    {
      seed: data.seed,
      sourceCorpus: corpus.version,
      parentLanguageHash: language.frozenHash,
      corpus: corpus.corpus.length,
      programs: data.programs.length,
      decisions: data.decisions.length,
      corpusPrograms: data.programs.filter((p) => p.source === "corpus").length,
      generationMs: performance.now() - start,
      note: "Training tasks only plus executed dreams; no final target programs. Prior and language now trained jointly through refactored corpus. Folded integer constants are lowered to available base arithmetic before teacher decisions. New exposure audit required before final testing.",
    },
    null,
    2,
  ),
);
console.log({
  programs: data.programs.length,
  decisions: data.decisions.length,
  corpusPrograms: data.programs.filter((p) => p.source === "corpus").length,
});
