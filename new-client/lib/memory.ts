import { supabase } from './supabaseClient';

export type MemoryType = 'preference' | 'identity' | 'constraint' | 'workflow' | 'project' | 'instruction' | 'other';

export interface MemoryItem {
  id: string;
  type: MemoryType;
  title: string;
  content: string;
  enabled: boolean;
  created_at?: string;
}

export async function fetchMemories({
  query = '',
  type = 'all',
  limit = 50,
}: { query?: string; type?: MemoryType | 'all'; limit?: number }) {
  let q = supabase
    .from('memories')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (type && type !== 'all') q = q.eq('type', type);
  if (query) q = q.ilike('content', `%${query}%`);
  const { data, error } = await q;
  if (error) throw error;
  return data as MemoryItem[];
}

export async function updateMemoryEnabled(id: string, enabled: boolean) {
  const { error } = await supabase
    .from('memories')
    .update({ enabled })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteMemory(id: string) {
  const { error } = await supabase
    .from('memories')
    .delete()
    .eq('id', id);
  if (error) throw error;
}
