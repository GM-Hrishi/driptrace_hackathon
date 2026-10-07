import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // No production source maps: do not ship readable app internals to judges' devices.
    sourcemap: false,
    rollupOptions: {
      output: {
        // Split the heavy, rarely-changing vendors so the ward view boots fast.
        // Vite 8 bundles with Rolldown, which takes manualChunks only as a
        // function - the object form is rejected at config time.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          // Firestore (and the gRPC transport it drags in) must stay unassigned
          // so its dynamic import in lib/firebase.js can split it off. Naming a
          // chunk here would pull it straight back into the initial payload.
          if (id.includes('firebase/firestore') || id.includes('/@grpc/')) return undefined
          if (id.includes('/firebase/') || id.includes('/@firebase/')) return 'firebase'
          if (id.includes('/recharts/') || id.includes('/d3-')) return 'charts'
          return undefined
        },
      },
    },
  },
})
