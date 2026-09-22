import "../../lib/capsule-core.js";

const Capsule=globalThis.AtlanexCapsule;
if(!Capsule)throw new Error("Atlanex Capsule core failed to initialize");

export const {
  stableStringify,
  sha256Hex,
  redactSecrets,
  createCapsule,
  verifyCapsule,
  summary,
  compareCapsules,
  generateSigningKey,
  keyFingerprint,
  signCapsule,
  verifySignature,
  publicJwkFromPrivateJwk,\n  timelineProfile,\n  compareCapsulesAdvanced,\n  incidentWindow,\n  minimizeCapsule,\n  createRegressionTestcase,\n  runRegressionTestcase
}=Capsule;

export default Capsule;
