import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import typescript from "@rollup/plugin-typescript";
import terser from "@rollup/plugin-terser";

const tsPlugin = (extraOpts = {}) =>
  typescript({
    tsconfig: "./tsconfig.json",
    declaration: false,
    declarationDir: undefined,
    ...extraOpts,
  });

// hypha-rpc is built by webpack with `output.globalObject: 'this'`, so its chunk
// runtime does `this.webpackChunkhyphaWebsocket...`. Inside the (strict-mode)
// module factory `this` is undefined, so the bundle throws on load. Rewrite it
// to `globalThis`. This is required for the bundle to load at all (via <script>
// or npm) — not a CSP workaround.
const patchWebpackThis = () => ({
  name: "patch-webpack-this",
  renderChunk(code) {
    return code
      .replace(/\bthis\[(["']webpackChunk[^"']+["'])\]/g, "globalThis[$1]")
      .replace(/\bthis\.webpackChunk([A-Za-z_$][A-Za-z0-9_$]*)/g, "globalThis.webpackChunk$1");
  },
});

export default [
  // ESM build (hypha-rpc is external — users import it separately)
  {
    input: "src/index.ts",
    output: {
      file: "dist/hypha-debugger.mjs",
      format: "esm",
      sourcemap: true,
    },
    external: ["hypha-rpc"],
    plugins: [resolve(), commonjs(), tsPlugin()],
  },
  // UMD build — everything bundled (single script tag, no dependencies)
  {
    input: "src/index.ts",
    output: {
      file: "dist/hypha-debugger.js",
      format: "umd",
      name: "hyphaDebugger",
      sourcemap: true,
      inlineDynamicImports: true,
    },
    plugins: [resolve({ browser: true }), commonjs(), tsPlugin(), patchWebpackThis()],
  },
  // Minified UMD build — everything bundled
  {
    input: "src/index.ts",
    output: {
      file: "dist/hypha-debugger.min.js",
      format: "umd",
      name: "hyphaDebugger",
      sourcemap: true,
      inlineDynamicImports: true,
    },
    plugins: [resolve({ browser: true }), commonjs(), tsPlugin(), terser(), patchWebpackThis()],
  },
];
