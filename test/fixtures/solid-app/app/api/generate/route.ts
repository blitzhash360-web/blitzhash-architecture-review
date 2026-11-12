import OpenAI from 'openai';
import { z } from 'zod';
import { getSupabase } from '@/lib/server';
import { ratelimit } from '@/lib/ratelimit';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const Body = z.object({ goal: z.string().max(500) });

export async function POST(req: Request) {
  const supabase = await getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  if (!(await ratelimit.limit(`ai:${user.id}`)).success) return new Response('Daily limit reached', { status: 429 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return new Response('Bad request', { status: 400 });
  const completion = await openai.chat.completions.create({ model: 'gpt-4o-mini', max_tokens: 600, messages: [{ role: 'user', content: parsed.data.goal }] });
  return Response.json({ plan: completion.choices[0].message.content });
}
