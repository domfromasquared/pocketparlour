// apps/client/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/pocketparlour/",
  plugins: [react()],
  server: {
    host: true,
    port: Number(process.env.VITE_DEV_PORT ?? 5173),
    strictPort: false
  }
});
