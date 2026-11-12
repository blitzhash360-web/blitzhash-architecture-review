import { getSupabase } from '@/lib/server';

export default async function Dashboard() {
  const supabase = await getSupabase();
  const { data } = await supabase.from('projects').select('id, name, tasks(id, title)').order('created_at').range(0, 49);
  return <pre>{JSON.stringify(data)}</pre>;
}
