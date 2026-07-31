// Deliberately "firebase-functions/logger", not the "firebase-functions/v2" barrel — the barrel
// eagerly loads every v2 provider module (scheduler, https, database, ...) even though only
// `logger` is used here, and the database provider transitively requires @firebase/database-compat,
// which has an unmet peer dependency on @firebase/app in this project's install (this app doesn't
// use Realtime Database at all). That pulled a genuinely broken module into every function's bundle
// and crashed every deployed revision's container on startup ("Cannot find module '@firebase/app'"),
// silently leaving the previous revision serving all traffic — a fix could be deployed successfully
// by every measure (CI green, `firebase deploy` exit 0) while never actually going live.
import * as logger from "firebase-functions/logger";

export const log = logger;
