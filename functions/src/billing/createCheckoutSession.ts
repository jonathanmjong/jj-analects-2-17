import { onCall, HttpsError } from "firebase-functions/v2/https";
import { collections } from "../lib/firestore.js";
import { getStripeClient, stripePriceId, stripeSecretKey } from "./stripeClient.js";

const TRIAL_DAYS = 7;

export const createCheckoutSession = onCall(
  { secrets: [stripeSecretKey, stripePriceId] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in before starting checkout.");
    }
    const uid = request.auth.uid;
    const email = request.auth.token.email as string | undefined;
    const { successUrl, cancelUrl } = (request.data ?? {}) as { successUrl?: string; cancelUrl?: string };
    if (!successUrl || !cancelUrl) {
      throw new HttpsError("invalid-argument", "successUrl and cancelUrl are required.");
    }

    const stripe = getStripeClient();
    const userRef = collections.users().doc(uid);
    const userSnap = await userRef.get();
    let customerId = userSnap.data()?.stripeCustomerId as string | undefined;

    if (!customerId) {
      const customer = await stripe.customers.create({ email, metadata: { firebaseUid: uid } });
      customerId = customer.id;
      await userRef.set({ stripeCustomerId: customerId, updatedAt: new Date().toISOString() }, { merge: true });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: uid,
      line_items: [{ price: stripePriceId.value(), quantity: 1 }],
      subscription_data: {
        trial_period_days: TRIAL_DAYS,
        metadata: { firebaseUid: uid },
      },
      allow_promotion_codes: true,
      success_url: successUrl,
      cancel_url: cancelUrl,
    });

    return { url: session.url };
  },
);
