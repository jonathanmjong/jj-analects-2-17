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
        case "customer.subscription.updated":
        case "customer.subscription.deleted": {
          await syncSubscription(event.data.object as Stripe.Subscription);
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
