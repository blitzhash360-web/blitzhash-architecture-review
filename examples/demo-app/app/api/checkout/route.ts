import Stripe from 'stripe';

const stripe = new Stripe('__FAKE_STRIPE_KEY__');

export async function POST(req: Request) {
  const { priceId, email } = await req.json();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: email,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: 'https://example.com/success',
    cancel_url: 'https://example.com/pricing',
  });
  return Response.json({ url: session.url });
}
