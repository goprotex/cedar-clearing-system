import { NextResponse } from 'next/server';
import { createClient, getUserFromRequest } from '@/utils/supabase/server';
import { machineFromJson, machineToJson, newMachineId } from '@/lib/fleet-storage';

export async function GET(req: Request) {
  const supabase = await createClient(req);
  const { data: auth } = await getUserFromRequest(supabase, req);
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile, error: pErr } = await supabase
    .from('profiles')
    .select('company_id')
    .eq('id', userId)
    .maybeSingle();
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!profile?.company_id) return NextResponse.json({ machines: [] });

  const { data, error } = await supabase
    .from('fleet_machines')
    .select('id, data, created_at, updated_at')
    .eq('company_id', profile.company_id)
    .order('updated_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const machines = (data ?? []).map((row: { id: string; data: unknown; created_at: string; updated_at: string }) => ({
    rowId: row.id,
    machine: machineFromJson(row.data, row.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  return NextResponse.json({ machines });
}

export async function POST(req: Request) {
  const supabase = await createClient(req);
  const { data: auth } = await getUserFromRequest(supabase, req);
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile, error: pErr } = await supabase
    .from('profiles')
    .select('company_id, role')
    .eq('id', userId)
    .maybeSingle();
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
  if (!profile?.company_id) {
    return NextResponse.json({ error: 'No company — join or create a company first' }, { status: 403 });
  }

  const role = profile.role as string | null;
  if (role === 'operator' || role === 'viewer') {
    return NextResponse.json({ error: 'Forbidden — only owners, managers and crew leads can add equipment' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const machineData = {
    id: newMachineId(),
    name: typeof body.name === 'string' && body.name.trim() ? body.name.trim().toUpperCase().replace(/\s+/g, '_') : 'NEW_UNIT',
    type: typeof body.type === 'string' ? body.type.trim().slice(0, 100) : 'Equipment',
    model: typeof body.model === 'string' ? body.model.trim().slice(0, 100) : '—',
    status: 'idle',
    hours: typeof body.hours === 'number' && Number.isFinite(body.hours) ? body.hours : 0,
    fuelLevel: 0,
    lastLocation: typeof body.lastLocation === 'string' ? body.lastLocation.trim().slice(0, 200) : '—',
    operator: typeof body.operator === 'string' ? body.operator.trim().slice(0, 100) : 'Unassigned',
    currentJob: '',
    dailyAcres: 0,
    avgFuelPerHr: typeof body.avgFuelPerHr === 'number' && Number.isFinite(body.avgFuelPerHr) ? body.avgFuelPerHr : 0,
    nextService: typeof body.nextService === 'string' ? body.nextService.slice(0, 20) : '',
    notes: typeof body.notes === 'string' ? body.notes.slice(0, 2000) : '',
    photoUrls: [],
    maintenanceLog: [],
    fuelLog: [],
    hoursLog: [],
  };

  const { data, error } = await supabase
    .from('fleet_machines')
    .insert({ company_id: profile.company_id, data: machineToJson(machineFromJson(machineData, '')) })
    .select('id, data, created_at, updated_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    rowId: data.id,
    machine: machineFromJson(data.data, data.id),
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  }, { status: 201 });
}
