/**
 * Supabase database helpers for persisting bids and pastures.
 *
 * Provides typed CRUD that maps between the app's camelCase TypeScript
 * types and the snake_case Postgres columns.  Falls back gracefully
 * when Supabase is not configured (unauthenticated / offline).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Bid, BidSummary, Pasture, CustomLineItem, RateCard } from '@/types';

// ─── Row types (Postgres snake_case) ────────────────────────────────────────

export interface BidRow {
  id: string;
  company_id: string | null;
  client_id: string | null;
  created_by: string | null;
  bid_number: string;
  status: string;
  client_name: string;
  client_email: string;
  client_phone: string;
  client_address: string;
  property_name: string;
  property_address: string;
  property_center: [number, number] | null;
  map_zoom: number;
  total_acreage: number;
  total_amount: number;
  estimated_days_low: number;
  estimated_days_high: number;
  mobilization_fee: number;
  burn_permit_fee: number;
  custom_line_items: CustomLineItem[];
  contingency_pct: number;
  discount_pct: number;
  notes: string;
  valid_until: string | null;
  rate_card_snapshot: RateCard | null;
  ai_confidence_score: number | null;
  prediction_model_version: number | null;
  created_at: string;
  updated_at: string;
}

export interface PastureRow {
  id: string;
  bid_id: string;
  name: string;
  sort_order: number;
  polygon: GeoJSON.Feature<GeoJSON.Polygon>;
  acreage: number;
  centroid: [number, number] | null;
  vegetation_type: string;
  density: string;
  terrain: string;
  clearing_method: string;
  disposal_method: string;
  soil_data: unknown | null;
  soil_multiplier: number;
  soil_multiplier_override: number | null;
  elevation_ft: number | null;
  cedar_analysis: unknown | null;
  seasonal_analysis: unknown | null;
  ai_density_score: number | null;
  ai_cedar_coverage_pct: number | null;
  ai_oak_coverage_pct: number | null;
  ai_tree_count: unknown | null;
  ai_heatmap_url: string | null;
  ai_tree_positions: unknown | null;
  adders: unknown[];
  saved_trees: unknown[];
  subtotal: number;
  method_multiplier: number;
  estimated_hrs_per_acre: number;
  predicted_hrs_per_acre: number | null;
  prediction_confidence: number | null;
  notes: string;
  created_at: string;
}

// ─── Converters ─────────────────────────────────────────────────────────────

export function bidToRow(bid: Bid, userId?: string): Omit<BidRow, 'created_at' | 'updated_at'> {
  return {
    id: bid.id,
    company_id: null,
    client_id: null,
    created_by: userId ?? null,
    bid_number: bid.bidNumber,
    status: bid.status,
    client_name: bid.clientName,
    client_email: bid.clientEmail,
    client_phone: bid.clientPhone,
    client_address: bid.clientAddress,
    property_name: bid.propertyName,
    property_address: bid.propertyAddress,
    property_center: bid.propertyCenter,
    map_zoom: bid.mapZoom,
    total_acreage: bid.totalAcreage,
    total_amount: bid.totalAmount,
    estimated_days_low: bid.estimatedDaysLow,
    estimated_days_high: bid.estimatedDaysHigh,
    mobilization_fee: bid.mobilizationFee,
    burn_permit_fee: bid.burnPermitFee,
    custom_line_items: bid.customLineItems,
    contingency_pct: bid.contingencyPct,
    discount_pct: bid.discountPct,
    notes: bid.notes,
    valid_until: bid.validUntil || null,
    rate_card_snapshot: bid.rateCardSnapshot,
    ai_confidence_score: null,
    prediction_model_version: null,
  };
}

export function rowToBid(row: BidRow, pastures: Pasture[]): Bid {
  return {
    id: row.id,
    bidNumber: row.bid_number,
    status: row.status as Bid['status'],
    clientName: row.client_name ?? '',
    clientEmail: row.client_email ?? '',
    clientPhone: row.client_phone ?? '',
    clientAddress: row.client_address ?? '',
    propertyName: row.property_name ?? '',
    propertyAddress: row.property_address ?? '',
    propertyCenter: row.property_center ?? [-99.1403, 30.0469],
    mapZoom: row.map_zoom ?? 14,
    pastures,
    totalAcreage: row.total_acreage ?? 0,
    totalAmount: Number(row.total_amount) || 0,
    estimatedDaysLow: row.estimated_days_low ?? 0,
    estimatedDaysHigh: row.estimated_days_high ?? 0,
    mobilizationFee: Number(row.mobilization_fee) || 0,
    burnPermitFee: Number(row.burn_permit_fee) || 0,
    customLineItems: (row.custom_line_items as CustomLineItem[]) ?? [],
    contingencyPct: row.contingency_pct ?? 0,
    discountPct: row.discount_pct ?? 0,
    notes: row.notes ?? '',
    validUntil: row.valid_until ?? '',
    rateCardSnapshot: (row.rate_card_snapshot as RateCard) ?? null as unknown as RateCard,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function pastureToRow(p: Pasture, bidId: string): Omit<PastureRow, 'created_at'> {
  return {
    id: p.id,
    bid_id: bidId,
    name: p.name,
    sort_order: p.sortOrder,
    polygon: p.polygon,
    acreage: p.acreage,
    centroid: p.centroid,
    vegetation_type: p.vegetationType,
    density: p.density,
    terrain: p.terrain,
    clearing_method: p.clearingMethod,
    disposal_method: p.disposalMethod,
    soil_data: p.soilData,
    soil_multiplier: p.soilMultiplier,
    soil_multiplier_override: p.soilMultiplierOverride,
    elevation_ft: p.elevationFt,
    cedar_analysis: p.cedarAnalysis,
    seasonal_analysis: p.seasonalAnalysis,
    ai_density_score: null,
    ai_cedar_coverage_pct: null,
    ai_oak_coverage_pct: null,
    ai_tree_count: null,
    ai_heatmap_url: null,
    ai_tree_positions: null,
    adders: p.adders ?? [],
    saved_trees: p.savedTrees ?? [],
    subtotal: p.subtotal,
    method_multiplier: p.methodMultiplier,
    estimated_hrs_per_acre: p.estimatedHrsPerAcre,
    predicted_hrs_per_acre: null,
    prediction_confidence: null,
    notes: p.notes,
  };
}

export function rowToPasture(row: PastureRow): Pasture {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    polygon: row.polygon as GeoJSON.Feature<GeoJSON.Polygon>,
    acreage: row.acreage,
    centroid: (row.centroid as [number, number]) ?? [-99.1403, 30.0469],
    vegetationType: row.vegetation_type as Pasture['vegetationType'],
    density: row.density as Pasture['density'],
    terrain: row.terrain as Pasture['terrain'],
    clearingMethod: row.clearing_method as Pasture['clearingMethod'],
    disposalMethod: row.disposal_method as Pasture['disposalMethod'],
    soilData: row.soil_data as Pasture['soilData'],
    soilMultiplier: row.soil_multiplier ?? 1.0,
    soilMultiplierOverride: row.soil_multiplier_override ?? null,
    elevationFt: row.elevation_ft ?? null,
    cedarAnalysis: row.cedar_analysis as Pasture['cedarAnalysis'],
    seasonalAnalysis: row.seasonal_analysis as Pasture['seasonalAnalysis'],
    adders: (row.adders ?? []) as Pasture['adders'],
    savedTrees: (row.saved_trees ?? []) as Pasture['savedTrees'],
    subtotal: Number(row.subtotal) || 0,
    methodMultiplier: row.method_multiplier ?? 1.0,
    estimatedHrsPerAcre: row.estimated_hrs_per_acre ?? 1.0,
    notes: row.notes ?? '',
  };
}

// ─── CRUD operations ────────────────────────────────────────────────────────

export async function saveBidToSupabase(
  supabase: SupabaseClient,
  bid: Bid,
  userId: string,
): Promise<{ error: string | null }> {
  const bidRow = bidToRow(bid, userId);

  const { error: bidErr } = await supabase
    .from('bids')
    .upsert({
      ...bidRow,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });

  if (bidErr) return { error: bidErr.message };

  const existingRes = await supabase
    .from('pastures')
    .select('id')
    .eq('bid_id', bid.id);

  const existingIds = new Set((existingRes.data ?? []).map((r: { id: string }) => r.id));
  const currentIds = new Set(bid.pastures.map((p) => p.id));

  const toDelete = [...existingIds].filter((id) => !currentIds.has(id));
  if (toDelete.length > 0) {
    await supabase.from('pastures').delete().in('id', toDelete);
  }

  if (bid.pastures.length > 0) {
    const rows = bid.pastures.map((p) => pastureToRow(p, bid.id));
    const { error: pastureErr } = await supabase
      .from('pastures')
      .upsert(rows, { onConflict: 'id' });
    if (pastureErr) return { error: pastureErr.message };
  }

  return { error: null };
}

export async function loadBidFromSupabase(
  supabase: SupabaseClient,
  bidId: string,
): Promise<{ bid: Bid | null; error: string | null }> {
  const { data: bidRow, error: bidErr } = await supabase
    .from('bids')
    .select('*')
    .eq('id', bidId)
    .maybeSingle();

  if (bidErr) return { bid: null, error: bidErr.message };
  if (!bidRow) return { bid: null, error: null };

  const { data: pastureRows, error: pastureErr } = await supabase
    .from('pastures')
    .select('*')
    .eq('bid_id', bidId)
    .order('sort_order', { ascending: true });

  if (pastureErr) return { bid: null, error: pastureErr.message };

  const pastures = (pastureRows ?? []).map((r: PastureRow) => rowToPasture(r));
  const bid = rowToBid(bidRow as BidRow, pastures);

  return { bid, error: null };
}

export async function loadBidListFromSupabase(
  supabase: SupabaseClient,
): Promise<{ bids: BidSummary[]; error: string | null }> {
  const { data, error } = await supabase
    .from('bids')
    .select('id, bid_number, status, client_name, property_name, total_acreage, total_amount, created_at, updated_at')
    .order('updated_at', { ascending: false })
    .limit(200);

  if (error) return { bids: [], error: error.message };

  const bids: BidSummary[] = (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    bidNumber: r.bid_number as string,
    status: r.status as BidSummary['status'],
    clientName: (r.client_name as string) ?? '',
    propertyName: (r.property_name as string) ?? '',
    totalAcreage: (r.total_acreage as number) ?? 0,
    totalAmount: Number(r.total_amount) || 0,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  }));

  return { bids, error: null };
}

export async function deleteBidFromSupabase(
  supabase: SupabaseClient,
  bidId: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('bids').delete().eq('id', bidId);
  return { error: error?.message ?? null };
}

/**
 * Check if the current user is authenticated and get their user id.
 * Returns null if not authenticated (triggers localStorage fallback).
 */
export async function getAuthUserId(
  supabase: SupabaseClient,
): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

// ─── One-time migration ─────────────────────────────────────────────────────

export const BIDS_MIGRATION_FLAG = 'ccc_bids_supabase_migrated_v1';

/**
 * Migrate localStorage bids into Supabase.
 *
 * Reads every `ccc_bid_<id>` key, upserts the full bid (with pastures) into
 * Supabase, then sets a migration flag so it only runs once per browser.
 *
 * Returns the count of bids migrated (0 if already migrated or nothing to do).
 */
export async function migrateBidsToSupabase(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ migrated: number; error: string | null }> {
  if (typeof window === 'undefined') return { migrated: 0, error: null };
  if (localStorage.getItem(BIDS_MIGRATION_FLAG) === '1') return { migrated: 0, error: null };

  const listRaw = localStorage.getItem('ccc_bid_list');
  const localList: Array<{ id: string }> = listRaw ? JSON.parse(listRaw) : [];
  if (localList.length === 0) {
    localStorage.setItem(BIDS_MIGRATION_FLAG, '1');
    return { migrated: 0, error: null };
  }

  let migrated = 0;
  for (const entry of localList) {
    const raw = localStorage.getItem(`ccc_bid_${entry.id}`);
    if (!raw) continue;

    try {
      const bid: Bid = JSON.parse(raw);
      const { error } = await saveBidToSupabase(supabase, bid, userId);
      if (error) {
        console.warn(`[db] migration: failed to migrate bid ${entry.id}:`, error);
        continue;
      }
      migrated++;
    } catch (e) {
      console.warn(`[db] migration: bad JSON for bid ${entry.id}:`, e);
    }
  }

  localStorage.setItem(BIDS_MIGRATION_FLAG, '1');
  return { migrated, error: null };
}
