export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "none";

/** Firestore doc: users/{uid} */
export interface UserProfile {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: SubscriptionStatus;
  trialEnd: string | null;
  currentPeriodEnd: string | null;
  watchlist: string[];
  /** uid of the user whose referral link brought this user in, captured at signup. Null if none/direct. */
  referredBy: string | null;
  /** True once referredBy's free-month reward has been granted for this user's first paid conversion — prevents double-crediting. */
  referralCreditGranted: boolean;
  createdAt: string;
  updatedAt: string;
}

export const ACTIVE_ACCESS_STATUSES: SubscriptionStatus[] = ["trialing", "active"];
