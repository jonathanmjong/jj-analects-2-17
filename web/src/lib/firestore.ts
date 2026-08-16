/**
 * The Firestore API surface this app actually uses, re-exported so it can be
 * loaded on demand (see loadFirestore in ./firebase).
 *
 * Consumers must `await import("./firestore")` rather than
 * `await import("firebase/firestore")`: a dynamically imported module's
 * namespace object is retained whole, so importing the SDK's own barrel keeps
 * every symbol it re-exports alive and defeats tree-shaking — measured at
 * 517kB vs 402kB raw for the firestore chunk. Narrowing the dynamic-import
 * boundary to the calls below restores it. Add to this list when a new call is
 * needed; nothing else has to change.
 */
export {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
