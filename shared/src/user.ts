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
  createdAt: string;
  updatedAt: string;
}

export const ACTIVE_ACCESS_STATUSES: SubscriptionStatus[] = ["trialing", "active"];
