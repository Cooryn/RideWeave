import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "android" ? "chrome74" : undefined,
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, ".worktrees/**"],
  },
});
