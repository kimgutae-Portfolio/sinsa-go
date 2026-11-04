import { build } from "esbuild";
await build({
  entryPoints: ["server/index.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
  outfile: "dist-server/index.mjs",
  sourcemap: true,
});
console.log("Realtime server built: dist-server/index.mjs");
