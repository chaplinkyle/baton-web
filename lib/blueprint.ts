import blueprint from "./plutus.json";

const validator = (() => {
  const found = blueprint.validators.find(
    (candidate) => candidate.title === "baton.baton.spend",
  );
  if (!found) throw new Error("Baton validator missing from blueprint");
  return found;
})();

export function blueprintSummary() {
  return {
    compiler: blueprint.preamble.compiler.version,
    rawHash: validator.hash,
    compiledBytes: validator.compiledCode.length / 2,
  };
}
