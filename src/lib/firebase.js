import { initializeApp } from 'firebase/app'
import { getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth'
import { getDatabase } from 'firebase/database'

/**
 * Firebase bootstrap.
 *
 * These values identify the project to the browser. They are not credentials
 * and grant nothing on their own - every read is gated by `auth != null` and
 * every client write is denied outright in firebase/database.rules.json and
 * firebase/firestore.rules. Authorization is rules-side, never client-side.
 *
 * Nothing in this module ever logs the config object.
 */

const REQUIRED_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_DATABASE_URL',
]

const env = import.meta.env

/** Keys absent from .env.local. Used to render a setup notice, not to crash. */
export const missingFirebaseConfig = REQUIRED_KEYS.filter((key) => !env[key])

/** True when the app has enough config to talk to Firebase at all. */
export const isFirebaseConfigured = missingFirebaseConfig.length === 0

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  databaseURL: env.VITE_FIREBASE_DATABASE_URL,
}

export const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null
export const auth = app ? getAuth(app) : null
export const rtdb = app ? getDatabase(app) : null

/** @type {Promise<import('firebase/firestore').Firestore | null> | null} */
let firestorePromise = null

/**
 * Firestore holds bed configuration, not live telemetry, and its SDK is the
 * single largest dependency in the project. Loading it on demand keeps it out
 * of the chunk that paints the ward view.
 *
 * @returns {Promise<import('firebase/firestore').Firestore | null>}
 */
export async function getFirestoreLazy() {
  if (!app) return null
  if (!firestorePromise) {
    firestorePromise = import('firebase/firestore').then(({ getFirestore }) => getFirestore(app))
  }
  return firestorePromise
}

/** Realtime Database path the ESP32 units publish bed readings under. */
export const BEDS_PATH = env.VITE_FIREBASE_BEDS_PATH || 'beds'

/** Append-only per-bed history, read by the flow-rate trend chart. */
export const HISTORY_PATH = 'history'

const useAnonAuth = env.VITE_FIREBASE_ANON_AUTH !== 'false'

/**
 * Sign in silently so the rules can demand an authenticated reader without
 * putting a login wall in front of ward staff or judges opening the link.
 *
 * Errors are returned generically. Firebase's own auth error codes are not
 * surfaced to the UI, so nothing here can be used to probe which accounts or
 * projects exist.
 *
 * @returns {Promise<{ ok: boolean, uid?: string, error?: string }>}
 */
export async function ensureSignedIn() {
  if (!auth) {
    return { ok: false, error: 'Firebase is not configured.' }
  }
  if (auth.currentUser) {
    return { ok: true, uid: auth.currentUser.uid }
  }
  if (!useAnonAuth) {
    return { ok: false, error: 'Sign in required.' }
  }
  try {
    const credential = await signInAnonymously(auth)
    return { ok: true, uid: credential.user.uid }
  } catch {
    // Deliberately generic: no error code, no account or project enumeration.
    return { ok: false, error: 'Could not connect to the monitoring service.' }
  }
}

/**
 * @param {(uid: string | null) => void} callback
 * @returns {() => void} unsubscribe
 */
export function watchAuth(callback) {
  if (!auth) {
    callback(null)
    return () => {}
  }
  return onAuthStateChanged(auth, (user) => callback(user ? user.uid : null))
}
