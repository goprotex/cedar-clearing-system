import { NextResponse } from 'next/server';
import { createClient, getUserFromRequest } from '@/utils/supabase/server';
import { machineFromJson, machineToJson } from '@/lib/fleet-storage';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient(req);
  const { data: auth } = await getUserFromRequest(supabase, req);
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id')
    .eq('id', userId)
    .maybeSingle();
  if (!profile?.company_id) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data, error } = await supabase
    .from('fleet_machines')
    .select('id, data, created_at, updated_at')
    .eq('id', id)
    .eq('company_id', profile.company_id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({
    rowId: data.id,
    machine: machineFromJson(data.data, data.id),
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient(req);
  const { data: auth } = await getUserFromRequest(supabase, req);
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id, role')
    .eq('id', userId)
    .maybeSingle();
  if (!profile?.company_id) return NextResponse.json({ error: 'No company' }, { status: 403 });

  const role = profile.role as string | null;
  if (role === 'viewer') {
    return NextResponse.json({ error: 'Forbidden — viewers cannot modify equipment' }, { status: 403 });
  }

  // Load existing machine data
  const { data: existing, error: fetchErr } = await supabase
    .from('fleet_machines')
    .select('id, data')
    .eq('id', id)
    .eq('company_id', profile.company_id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const current = machineFromJson(existing.data, existing.id);

  const VALID_STATUSES = new Set(['active', 'idle', 'maintenance', 'offline']);
  const VALID_CATEGORIES = new Set(['truck', 'trailer', 'skid_steer', 'skid_steer_attachment', 'barko', 'dozer', 'excavator', 'small_equipment', 'other']);
  const VALID_CONDITIONS = new Set(['excellent', 'good', 'fair', 'poor', 'needs_repair']);

  // Merge allowed fields
  if (typeof body.name === 'string' && body.name.trim()) current.name = body.name.trim().toUpperCase().replace(/\s+/g, '_').slice(0, 100);
  if (typeof body.type === 'string') current.type = body.type.trim().slice(0, 100);
  if (typeof body.category === 'string' && VALID_CATEGORIES.has(body.category)) current.category = body.category as typeof current.category;
  if (typeof body.model === 'string') current.model = body.model.trim().slice(0, 100);
  if (typeof body.status === 'string' && VALID_STATUSES.has(body.status)) current.status = body.status as typeof current.status;
  if (typeof body.hours === 'number' && Number.isFinite(body.hours) && body.hours >= 0) current.hours = body.hours;
  if (typeof body.mileage === 'number' && Number.isFinite(body.mileage) && body.mileage >= 0) current.mileage = body.mileage;
  if (typeof body.fuelLevel === 'number' && Number.isFinite(body.fuelLevel)) current.fuelLevel = Math.max(0, Math.min(100, body.fuelLevel));
  if (typeof body.lastLocation === 'string') current.lastLocation = body.lastLocation.slice(0, 200);
  if (typeof body.operator === 'string') current.operator = body.operator.slice(0, 100);
  if (typeof body.currentJob === 'string') current.currentJob = body.currentJob.slice(0, 100);
  if (typeof body.dailyAcres === 'number' && Number.isFinite(body.dailyAcres)) current.dailyAcres = Math.max(0, body.dailyAcres);
  if (typeof body.avgFuelPerHr === 'number' && Number.isFinite(body.avgFuelPerHr)) current.avgFuelPerHr = Math.max(0, body.avgFuelPerHr);
  if (typeof body.nextService === 'string') current.nextService = body.nextService.slice(0, 20);
  if (typeof body.nextServiceHours === 'number' && Number.isFinite(body.nextServiceHours)) current.nextServiceHours = Math.max(0, body.nextServiceHours);
  if (typeof body.condition === 'string' && VALID_CONDITIONS.has(body.condition)) current.condition = body.condition as typeof current.condition;
  if (typeof body.serialNumber === 'string') current.serialNumber = body.serialNumber.slice(0, 100);
  if (typeof body.year === 'number' && Number.isFinite(body.year)) current.year = body.year;
  if (typeof body.make === 'string') current.make = body.make.slice(0, 100);
  if (typeof body.notes === 'string') current.notes = body.notes.slice(0, 2000);
  if (typeof body.thumbnailIndex === 'number' && Number.isFinite(body.thumbnailIndex)) current.thumbnailIndex = Math.max(0, body.thumbnailIndex);

  // Append-only log entries
  if (Array.isArray(body.maintenanceLog)) current.maintenanceLog = body.maintenanceLog as typeof current.maintenanceLog;
  if (Array.isArray(body.fuelLog)) current.fuelLog = body.fuelLog as typeof current.fuelLog;
  if (Array.isArray(body.hoursLog)) current.hoursLog = body.hoursLog as typeof current.hoursLog;
  if (Array.isArray(body.checkoutHistory)) current.checkoutHistory = body.checkoutHistory as typeof current.checkoutHistory;
  if (Array.isArray(body.photoUrls)) current.photoUrls = (body.photoUrls as string[]).filter((u) => typeof u === 'string').slice(0, 50);

  const { data, error } = await supabase
    .from('fleet_machines')
    .update({ data: machineToJson(current) })
    .eq('id', id)
    .eq('company_id', profile.company_id)
    .select('id, data, updated_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    rowId: data.id,
    machine: machineFromJson(data.data, data.id),
    updatedAt: data.updated_at,
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient(req);
  const { data: auth } = await getUserFromRequest(supabase, req);
  const userId = auth.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('company_id, role')
    .eq('id', userId)
    .maybeSingle();
  if (!profile?.company_id) return NextResponse.json({ error: 'No company' }, { status: 403 });

  const role = profile.role as string | null;
  if (role === 'operator' || role === 'viewer' || role === 'crew_lead') {
    return NextResponse.json({ error: 'Forbidden — only owners and managers can delete equipment' }, { status: 403 });
  }

  const { error } = await supabase
    .from('fleet_machines')
    .delete()
    .eq('id', id)
    .eq('company_id', profile.company_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
