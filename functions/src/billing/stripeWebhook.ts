import { onRequest } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import type Stripe from "stripe";
import { collections } from "../lib/firestore.js";
import { log } from "../lib/logger.js";
import { getStripeClient, stripeSecretKey, stripeWebhookSecret } from "./stripeClient.js";
import type { SubscriptionStatus } from "@proverbs/shared";
import { ACTIVE_ACCESS_STATUSES } from "@proverbs/shared";

async function findUidForCustomer(customerId: string): Promise<string | null> {
  const snap = await collections.users().where("stripeCustomerId", "==", customerId).limit(1).get();
  return snap.empty ? null : snap.docs[0].id;
}

async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const uid = (sub.metadata?.firebaseUid as string | undefined) ?? (await findUidForCustomer(sub.customer as string));
  if (!uid) {
    log.warn(`stripeWebhook: no Firebase uid found for Stripe customer ${sub.customer}`);
    return;
  }

  const status = sub.status as SubscriptionStatus;
  await collections.users().doc(uid).set(
    {
      stripeSubscriptionId: sub.id,
      subscriptionStatus: status,
      trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
      currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );

  await getAuth().setCustomUserClaims(uid, { subscribed: ACTIVE_ACCESS_STATUSES.includes(status) });
}

const REFERRAL_COUPON_ID = "referral-free-month";

/**
 * Referral reward: when a referred user's trial converts to a real paying
 * subscription (status transitions trialing -> active — the first actual
 * charge), the referrer gets one month free applied as a coupon on their
 * own subscription. Gated by referralCreditGranted on the REFERRED user's
 * doc so a re-delivered webhook (Stripe retries on any non-2xx) can't grant
 * the same reward twice.
 */
async function maybeGrantReferralReward(
  sub: Stripe.Subscription,
  previousAttributes: Partial<Stripe.Subscription> | undefined,
): Promise<void> {
  const becameActive = previousAttributes?.status === "trialing" && sub.status === "active";
  if (!becameActive) return;

  const uid = (sub.metadata?.firebaseUid as string | undefined) ?? (await findUidForCustomer(sub.customer as string));
  if (!uid) return;

  const userRef = collections.users().doc(uid);
  const userSnap = await userRef.get();
  const referredBy = userSnap.data()?.referredBy as string | null | undefined;
  const alreadyGranted = userSnap.data()?.referralCreditGranted as boolean | undefined;
  if (!referredBy || alreadyGranted) return;

  const referrerSnap = await collections.users().doc(referredBy).get();
  const referrerSubId = referrerSnap.data()?.stripeSubscriptionId as string | undefined;
  if (!referrerSubId) {
    log.warn(`stripeWebhook: referrer ${referredBy} has no subscription to credit (referred user ${uid})`);
    return;
  }

  try {
    const stripe = getStripeClient();
    await stripe.subscriptions.update(referrerSubId, { coupon: REFERRAL_COUPON_ID });
    await userRef.set({ referralCreditGranted: true, updatedAt: new Date().toISOString() }, { merge: true });
    log.info(`stripeWebhook: granted referral reward to ${referredBy} for referring ${uid}`);
  } catch (err) {
    log.error(`stripeWebhook: failed to apply referral coupon to referrer ${referredBy}'s subscription`, err);
  }
}

export const stripeWebhook = onRequest(
  { secrets: [stripeSecretKey, stripeWebhookSecret] },
  async (req, res) => {
    const signature = req.headers["stripe-signature"];
    if (!signature || typeof signature !== "string") {
      res.status(400).send("Missing stripe-signature header");
      return;
    }

    const stripe = getStripeClient();
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, signature, stripeWebhookSecret.value());
    } catch (err) {
      log.error("stripeWebhook: signature verification failed", err);
      res.status(400).send(`Webhook signature verification failed`);
      return;
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session;
          if (session.subscription) {
            const sub = await stripe.subscriptions.retrieve(session.subscription as string);
            await syncSubscription(sub);
          }
          break;
        }
        case "customer.subscription.created":
        case "customer.subscription.deleted": {
          await syncSubscription(event.data.object as Stripe.Subscription);
          break;
        }
        case "customer.subscription.updated": {
          const sub = event.data.object as Stripe.Subscription;
          const previousAttributes = (event.data as { previous_attributes?: Partial<Stripe.Subscription> }).previous_attributes;
          await syncSubscription(sub);
          await maybeGrantReferralReward(sub, previousAttributes);
          break;
        }
        default:
          break;
      }
      res.status(200).send({ received: true });
    } catch (err) {
      log.error(`stripeWebhook: failed handling ${event.type}`, err);
      res.status(500).send("Webhook handler error");
    }
  },
);
