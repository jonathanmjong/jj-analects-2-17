import { onCall, HttpsError } from "firebase-functions/v2/https";
import { collections } from "../lib/firestore.js";
import { getStripeClient, stripeSecretKey } from "./stripeClient.js";

export const createPortalSession = onCall({ secrets: [stripeSecretKey] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in first.");
  }
  const { returnUrl } = (request.data ?? {}) as { returnUrl?: string };
  if (!returnUrl) throw new HttpsError("invalid-argument", "returnUrl is required.");

  const userSnap = await collections.users().doc(request.auth.uid).get();
  const customerId = userSnap.data()?.stripeCustomerId as string | undefined;
  if (!customerId) throw new HttpsError("failed-precondition", "No Stripe customer on file yet.");

  const stripe = getStripeClient();
  const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
  return { url: session.url };
});
