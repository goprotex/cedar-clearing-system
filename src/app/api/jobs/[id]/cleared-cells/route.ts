import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/utils/supabase/server';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Ensure membership
  const { data: membership, error: membershipErr } = await supabase
    .from('job_members')
    .select('job_id')
    .eq('job_id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (membershipErr) return NextResponse.json({ error: membershipErr.message }, { status: 500 });
  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data: cells, error: cellsErr } = await supabase
    .from('job_cleared_cells')
    .select('cell_id, cleared_at, cleared_by')
    .eq('job_id', id)
    .order('cleared_at', { ascending: true })
    .limit(50000);
  if (cellsErr) return NextResponse.json({ error: cellsErr.message }, { status: 500 });

  const rows = cells ?? [];
  const cellIds = rows.map((c) => c.cell_id).filter((id): id is string => typeof id === 'string');

  return NextResponse.json({ cells: rows, cellIds });
}

