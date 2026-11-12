'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function Dashboard() {
  const [rows, setRows] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const { data: projects } = await supabase.from('projects').select('id, name');
      const all = [];
      for (const p of projects || []) {
        const { data: tasks } = await supabase.from('tasks').select('*').eq('project_id', p.id);
        all.push({ ...p, tasks });
      }
      setRows(all);
    })();
  }, []);

  return <pre>{JSON.stringify(rows, null, 2)}</pre>;
}
