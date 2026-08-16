import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFunctions } from "firebase/functions";

// Firebase web config is not a secret — it identifies the project to
// Google's servers, and access is actually governed by Firestore Security
// Rules (see /firestore.rules) plus Firebase Auth, not by hiding this
// object. See https://firebase.google.com/docs/projects/api-keys.
const firebaseConfig = {
  apiKey: "AIzaSyDEkcDgF397paJKi1t1q0sP5v2bW_XEutQ",
  authDomain: "jj-analects-2-17.firebaseapp.com",
  projectId: "jj-analects-2-17",
  storageBucket: "jj-analects-2-17.firebasestorage.app",
  messagingSenderId: "78445570174",
  appId: "1:78445570174:web:2ff370f54937826108902f",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const functions = getFunctions(app);
export const googleProvider = new GoogleAuthProvider();

/**
 * Firestore and Storage are loaded on demand rather than exported like the
 * others. A static export pulls the whole product SDK into the entry bundle for
 * every visitor including anonymous ones on the landing page, which reaches
 * Firestore only after sign-in (Firestore alone is ~400kB raw / ~115kB gzipped)
 * and Storage only for the ranking-universe download. The SDK caches instances
 * per app, so repeated calls are free — the awaits after the first are on an
 * already-resolved module.
 *
 * Callers pair loadFirestore() with a dynamic `import("./firestore")` for the
 * query helpers; both resolve from the same chunk, so it is one fetch.
 */
export async function loadFirestore() {
  const { getFirestore } = await import("./firestore");
  return getFirestore(app);
}

export async function loadStorage() {
  const { getStorage } = await import("firebase/storage");
  return getStorage(app);
}
