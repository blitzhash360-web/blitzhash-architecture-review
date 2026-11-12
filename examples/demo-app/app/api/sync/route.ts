import { createClient } from '@supabase/supabase-js';

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function GET() {
  const { count } = await admin.from('tasks').select('id', { count: 'exact', head: true });
  await admin.from('usage').update({ tasks: count }).eq('id', 1);
  return Response.json({ used: count });
}
