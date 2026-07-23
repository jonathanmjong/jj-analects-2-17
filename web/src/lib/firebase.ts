import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
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
export const db = getFirestore(app);
export const functions = getFunctions(app);
export const googleProvider = new GoogleAuthProvider();
