// Build stub for satellite.js optional WASM runtimes (vite.config.ts aliases "#wasm-*" here). The Atlas uses the
// pure-JS SGP4 (json2satrec/propagate); the multi-threaded WASM build needs a worker bundle the Worker cannot ship.
export default function unavailable(): never {
  throw new Error("satellite.js WASM runtime is not bundled in Regenera OS");
}
