import Stripe from "stripe";
import { defineSecret } from "firebase-functions/params";

export const stripeSecretKey = defineSecret("STRIPE_SECRET_KEY");
export const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
export const stripePriceId = defineSecret("STRIPE_PRICE_ID");

export function getStripeClient(): Stripe {
  return new Stripe(stripeSecretKey.value());
}
