import {
  ChallengeSearch,
  validateManifest,
  START_CHECK,
  type FrozenArtifact,
  type Manifest,
} from "./protocol";
self.onmessage = async (
  e: MessageEvent<{
    artifact: FrozenArtifact;
    manifest: Manifest;
    index: number;
    arm: "fixed" | "learned";
  }>,
) => {
  try {
    const { artifact, manifest, index, arm } = e.data;
    validateManifest(manifest, artifact);
    const encoded = new TextEncoder().encode(JSON.stringify(artifact.payload));
    const hash = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", encoded)),
    ]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    if (hash !== artifact.hash)
      throw Error("Frozen artifact checksum mismatch");
    const race = new ChallengeSearch(
      artifact,
      manifest.challenges[index],
      manifest.budget,
      arm === "learned" && manifest.mode === "learned"
        ? artifact.payload.macros
        : [],
      manifest.startCheck === START_CHECK,
    );
    let last = 0;
    while (true) {
      const state = race.advance();
      if (performance.now() - last > 80 || state.status !== "searching") {
        self.postMessage({ type: "progress", state });
        last = performance.now();
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (state.status !== "searching") break;
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
