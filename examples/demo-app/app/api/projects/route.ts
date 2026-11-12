import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

const Body = z.object({ name: z.string().min(1).max(80) });

export async function POST(req: Request) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return new Response('Bad request', { status: 400 });
  const { data } = await supabase.from('projects').insert({ name: parsed.data.name, owner_id: user.id }).select().single();
  return Response.json(data);
}
