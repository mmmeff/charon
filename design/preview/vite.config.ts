import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repoRoot = path.resolve(__dirname, "../..");
const realTauri = path.resolve(repoRoot, "src/lib/tauri.ts");
const stub = path.resolve(__dirname, "native-stub.ts");

/**
 * App files import the native bridge as "./lib/tauri", "../lib/tauri" and
 * "../../lib/tauri". A specifier alias cannot catch all three, so intercept
 * after resolution instead: resolve the id against its importer and compare
 * real paths.
 */
function stubNativeBridge() {
  return {
    name: "charon-preview-stub-native",
    enforce: "pre" as const,
    resolveId(source: string, importer: string | undefined) {
      if (!importer || !source.startsWith(".")) return null;
      const target = path.resolve(path.dirname(importer), source);
      if (target === realTauri || target + ".ts" === realTauri) return stub;
      return null;
    },
  };
}

export default defineConfig({
  root: __dirname,
  plugins: [stubNativeBridge(), react()],
  define: { __APP_VERSION__: JSON.stringify("preview") },
  clearScreen: false,
  server: { port: 5199, strictPort: true, fs: { allow: [repoRoot] } },
});
