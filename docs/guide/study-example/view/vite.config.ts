// Builds the lock's view and observer for Naima's Models tab into ../build/view.js and
// ../build/observer.js: ES modules that the tab's sandboxed frames import. Any code the
// two share goes to ../build/shared.js.
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import process from "node:process";

// Naima's widget library (Sequence, Graph and the rest): NAIMA_WIDGETS when set, else, since
// this example lives inside the product, the library four folders up. A project of your own
// points this at the Naima it uses, `<naima>/src/plugins/verifier-mcrl2/widgets/study`.
const widgets = process.env["NAIMA_WIDGETS"] ??
  fileURLToPath(new URL("../../../../src/plugins/verifier-mcrl2/widgets/study", import.meta.url));

export default defineConfig({
  root: import.meta.dirname,
  // The styles travel inside view.js, since the tab loads one module per frame.
  plugins: [svelte({ compilerOptions: { css: "injected" } })],
  resolve: {
    alias: { "@naima/study": widgets },
    // The widgets live outside this folder: they use this folder's copy of each package.
    dedupe: ["svelte", "@lucide/svelte"],
  },
  build: {
    outDir: "../build",
    emptyOutDir: false, // ../build also holds stepper.wasm
    minify: false, // left readable on purpose
    lib: {
      entry: { view: "src/view.ts", observer: "src/observer.svelte.ts" },
      formats: ["es"],
      cssFileName: "view",
      fileName: (_format, name) => `${name}.js`,
    },
    rollupOptions: { output: { chunkFileNames: "shared.js" } },
  },
});
