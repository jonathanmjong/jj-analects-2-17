const STORAGE_KEY = "analects_referral_code";

/** A referral code is just the referring user's uid — simple, unique, no separate generation/lookup needed. */

/** Call once on app load. Captures ?ref=<uid> from the URL into localStorage, first-touch wins (doesn't overwrite an existing stored code). */
export function captureReferralFromUrl(): void {
  const params = new URLSearchParams(window.location.search);
  const ref = params.get("ref");
  if (!ref) return;
  if (!window.localStorage.getItem(STORAGE_KEY)) {
    window.localStorage.setItem(STORAGE_KEY, ref);
  }
}

export function getStoredReferralCode(): string | null {
  return window.localStorage.getItem(STORAGE_KEY);
}

export function clearStoredReferralCode(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

export function referralLinkFor(uid: string): string {
  return `${window.location.origin}/?ref=${uid}`;
}
