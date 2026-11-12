'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function Home() {
  const [projects, setProjects] = useState<any[]>([]);
  const [usage, setUsage] = useState(0);

  useEffect(() => {
    supabase.from('projects').select('*').then(({ data }) => setProjects(data || []));
    const t = setInterval(() => {
      fetch('/api/sync').then((r) => r.json()).then((d) => setUsage(d.used));
    }, 2000);
    return () => clearInterval(t);
  }, []);

  return (
    <main>
      <h1>Your projects ({usage} AI credits used)</h1>
      {projects.map((p) => <a key={p.id} href={`/dashboard?id=${p.id}`}>{p.name}</a>)}
    </main>
  );
}
