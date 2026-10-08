import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

/**
 * Nurse app build. Same React code base and shared src/lib as the website,
 * bundled into the Android app's assets so MainActivity serves it locally
 * through WebViewAssetLoader.
 *
 *   npm run dev:app     preview in a desktop browser (phone width)
 *   npm run build:app   write app/.../src/main/assets/web/
 */

const repoRoot = fileURLToPath(new URL('.', import.meta.url))
const outDir = fileURLToPath(
  new URL('./app/DripTrace_Android_Project/app/app/src/main/assets/web', import.meta.url),
)

/**
 * MonitorService connects to Firebase natively while the phone is locked and
 * needs the same project identifiers the web build gets from .env.local. Only
 * the public web identifiers go in; they grant nothing without the rules, and
 * the firmware's database secret is never part of any app build.
 */
function nativeFirebaseConfig(env) {
  return {
    name: 'driptrace-native-firebase-config',
    apply: 'build',
    generateBundle() {
      const config = {
        apiKey: env.VITE_FIREBASE_API_KEY ?? '',
        projectId: env.VITE_FIREBASE_PROJECT_ID ?? '',
        appId: env.VITE_FIREBASE_APP_ID ?? '',
        databaseURL: (env.VITE_FIREBASE_DATABASE_URL ?? '').replace(/\/+$/, ''),
        bedsPath: env.VITE_FIREBASE_BEDS_PATH || 'beds',
      }
      if (!config.apiKey || !config.databaseURL) {
        this.warn('Firebase is not configured in .env.local: background alarms will not connect.')
      }
      this.emitFile({ type: 'asset', fileName: 'firebase-config.json', source: JSON.stringify(config, null, 2) })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, 'VITE_')
  return {
    root: fileURLToPath(new URL('./mobile', import.meta.url)),
    envDir: repoRoot,
    base: './',
    plugins: [react(), tailwindcss(), nativeFirebaseConfig(env)],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: { port: 5174 },
    build: {
      outDir,
      emptyOutDir: true,
      sourcemap: false,
      // Loaded from local assets, so chunk size matters far less than on the web.
      chunkSizeWarningLimit: 1500,
    },
  }
})
