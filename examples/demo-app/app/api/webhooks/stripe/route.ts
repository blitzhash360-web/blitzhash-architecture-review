import { createClient } from '@supabase/supabase-js';

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function POST(req: Request) {
  const event = JSON.parse(await req.text());
  if (event.type === 'checkout.session.completed') {
    await admin.from('subscriptions').upsert({ email: event.data.object.customer_email, status: 'active' });
  }
  return new Response('ok');
}
