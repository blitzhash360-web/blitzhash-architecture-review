'use client';
import { createClient } from '@supabase/supabase-js';

// TODO: lock this down before launch
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function deleteUserProjects(userId: string) {
  await admin.from('projects').delete().eq('owner_id', userId);
}
