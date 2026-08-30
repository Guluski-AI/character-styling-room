import vinext from "vinext";
import { defineConfig } from "vite";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
const usePollingForDevelopment =
  isCodexSeatbeltSandbox || process.env.STYLING_DEV_POLLING === "1";

export default defineConfig({
  cacheDir: ".vite-cache",
  server: usePollingForDevelopment
    ? { watch: { useFsEvents: false, usePolling: true } }
    : undefined,
  plugins: [vinext()],
});
