import Stripe from 'stripe';
import { z } from 'zod';
import { getSupabase } from '@/lib/server';
import { ratelimit } from '@/lib/ratelimit';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const Body = z.object({ priceId: z.string().startsWith('price_') });

export async function POST(req: Request) {
  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  if (!(await ratelimit.limit(user.id)).success) return new Response('Too many requests', { status: 429 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return new Response('Bad request', { status: 400 });
  const session = await stripe.checkout.sessions.create({ mode: 'subscription', customer_email: user.email, line_items: [{ price: parsed.data.priceId, quantity: 1 }], success_url: 'https://example.com/ok' });
  return Response.json({ url: session.url });
}
