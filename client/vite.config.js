import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      // Use @/ as shortcut for src/
      "@": path.resolve(__dirname, "./src"),
      "@components": path.resolve(__dirname, "./src/components"),
      "@pages": path.resolve(__dirname, "./src/pages"),
      "@hooks": path.resolve(__dirname, "./src/hooks"),
      "@services": path.resolve(__dirname, "./src/services"),
      "@store": path.resolve(__dirname, "./src/store"),
      "@utils": path.resolve(__dirname, "./src/utils"),
      "@assets": path.resolve(__dirname, "./src/assets"),
      "@layouts": path.resolve(__dirname, "./src/layouts"),
      "@context": path.resolve(__dirname, "./src/context"),
    },
  },

  server: {
    port: 5173,
    strictPort: false,
    // Proxy API/socket/upload requests to Express server in dev, so the
    // browser only ever talks to this one port (avoids CORS issues too).
    proxy: {
      "/api": {
        target: "http://localhost:5051",
        changeOrigin: true,
        secure: false,
      },
      "/socket.io": {
        target: "http://localhost:5051",
        changeOrigin: true,
        secure: false,
        ws: true,
      },
      "/uploads": {
        target: "http://localhost:5051",
        changeOrigin: true,
        secure: false,
      },
    },
  },

  build: {
    outDir: "dist",
    sourcemap: false, // Set to true for debugging prod builds
    minify: "esbuild",
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          // Split large vendor libs into separate chunks
          vendor: ["react", "react-dom"],
          router: ["react-router-dom"],
        },
      },
    },
  },

  preview: {
    port: 4173,
  },
});
