// Email allowlist, not a role system — matches functions/src/admin/adminOps.ts's
// ADMIN_EMAILS (kept as a separate copy there since functions/ and web/ don't share
// runtime code across the client/server boundary; this is the one place on the web
// side so the nav link and the page guard can't drift from each other).
const ADMIN_EMAILS = ["jonathanmjong@gmail.com"];

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.includes(email);
}
