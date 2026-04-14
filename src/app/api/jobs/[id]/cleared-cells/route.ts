import { NextResponse } from 'next/server';
import { createClient, getUserFromRequest } from '@/utils/supabase/server';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient(req);

  const { data: auth } = await getUserFromRequest(supabase, req);
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

  return NextResponse.json({ cells: cells ?? [] });
}

