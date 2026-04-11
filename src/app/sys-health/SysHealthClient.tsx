'use client';

import { useState, useCallback, useReducer } from 'react';
import AppShell from '@/components/AppShell';

type ServiceStatus = 'operational' | 'degraded' | 'down' | 'unchecked';

interface ServiceCheck {
  name: string;
  endpoint: string;
  status: ServiceStatus;
  latency: number | null;
  lastChecked: string | null;
  description: string;
}

const STATUS_STYLES: Record<ServiceStatus, { color: string; dot: string; label: string }> = {
  operational: { color: 'text-[#13ff43]', dot: 'bg-[#13ff43]', label: 'OPERATIONAL' },
  degraded: { color: 'text-amber-400', dot: 'bg-amber-500', label: 'DEGRADED' },
  down: { color: 'text-red-400', dot: 'bg-red-500', label: 'DOWN' },
  unchecked: { color: 'text-[#a98a7d]', dot: 'bg-[#a98a7d]', label: 'UNCHECKED' },
};

const INITIAL_SERVICES: ServiceCheck[] = [
  {
    name: 'CEDAR_DETECT',
    endpoint: '/api/cedar-detect',
    status: 'unchecked',
    latency: null,
    lastChecked: null,
    description: 'Spectral vegetation analysis engine',
  },
  {
    name: 'SOIL_DATA',
    endpoint: '/api/soil?lon=-99.14&lat=30.05',
    status: 'unchecked',
    latency: null,
    lastChecked: null,
    description: 'USDA SSURGO soil query service',
  },
  {
    name: 'ELEVATION',
    endpoint: '/api/elevation?lon=-99.14&lat=30.05',
    status: 'unchecked',
    latency: null,
    lastChecked: null,
    description: 'USGS elevation profile service',
  },
  {
    name: 'AI_POPULATE',
    endpoint: '/api/ai-populate',
    status: 'unchecked',
    latency: null,
    lastChecked: null,
    description: 'Anthropic AI recommendation engine',
  },
  {
    name: 'SEASONAL',
    endpoint: '/api/seasonal',
    status: 'unchecked',
    latency: null,
    lastChecked: null,
    description: 'Sentinel-2 seasonal analysis pipeline',
  },
  {
    name: 'CEDAR_CHECKPOINT',
    endpoint: '/api/cedar-checkpoint?health=1',
    status: 'unchecked',
    latency: null,
    lastChecked: null,
    description: 'Supabase resume storage for chunked spectral analysis (needs service role)',
  },
];

function getStorageUsed(): string {
  if (typeof window === 'undefined') return '0 KB';
  try {
    let totalSize = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) { totalSize += localStorage.getItem(key)?.length || 0; }
    }
    const kb = (totalSize * 2) / 1024;
    return kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(0)} KB`;
  } catch { return '0 KB'; }
}

function getBidCount(): number {
  if (typeof window === 'undefined') return 0;
  try { return JSON.parse(localStorage.getItem('ccc_bid_list') || '[]').length; } catch { return 0; }
}

async function checkSingleService(service: ServiceCheck): Promise<ServiceCheck> {
  const start = performance.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const method = service.endpoint.includes('cedar-detect') || service.endpoint.includes('ai-populate') || service.endpoint.includes('seasonal')
      ? 'POST'
      : 'GET';

    const opts: RequestInit = {
      method,
      signal: controller.signal,
      ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: '{}' } : {}),
    };

    const res = await fetch(service.endpoint, opts);
    clearTimeout(timeout);
    const latency = Math.round(performance.now() - start);

    return {
      ...service,
      status: res.ok || res.status === 400 ? 'operational' : 'degraded',
      latency,
      lastChecked: new Date().toISOString(),
    };
  } catch {
    const latency = Math.round(performance.now() - start);
    return {
      ...service,
      status: latency > 7500 ? 'down' : 'degraded',
      latency,
      lastChecked: new Date().toISOString(),
    };
  }
}

type DiagAction =
  | { type: 'start' }
  | { type: 'done'; results: ServiceCheck[] };

interface DiagState {
  services: ServiceCheck[];
  isRunning: boolean;
}

function diagReducer(state: DiagState, action: DiagAction): DiagState {
  switch (action.type) {
    case 'start':
      return { services: state.services.map((s) => ({ ...s, status: 'unchecked' as ServiceStatus })), isRunning: true };
    case 'done':
      return { services: action.results, isRunning: false };
  }
}

export default function SysHealthClient() {
  const [{ services, isRunning }, dispatch] = useReducer(diagReducer, { services: INITIAL_SERVICES, isRunning: false });
  const [storageUsed] = useState<string>(getStorageUsed);
  const [bidCount] = useState(getBidCount);

  const runAllChecks = useCallback(async () => {
    dispatch({ type: 'start' });
    const results = await Promise.all(INITIAL_SERVICES.map(checkSingleService));
    dispatch({ type: 'done', results });
  }, []);

  const mapboxConfigured = !!process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const supabaseConfigured = !!process.env.NEXT_PUBLIC_SUPABASE_URL;

  const operationalCount = services.filter((s) => s.status === 'operational').length;
  const overallStatus = operationalCount === services.length ? 'ALL_SYSTEMS_GO' :
    operationalCount > services.length / 2 ? 'PARTIAL_DEGRADATION' : 'CRITICAL';
  const overallColor = operationalCount === services.length ? '#13ff43' :
    operationalCount > services.length / 2 ? '#FF6B00' : '#ff4444';

  return (
    <AppShell>
      <div className="flex justify-between items-end border-l-4 border-[#FF6B00] pl-4 mb-8">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-tighter">SYS_HEALTH</h1>
          <p className="text-[#ffb693] text-xs font-mono">
            DIAGNOSTICS & SERVICE STATUS
          </p>
        </div>
        <button
          onClick={runAllChecks}
          disabled={isRunning}
          className="bg-[#FF6B00] text-black font-black px-4 py-2 text-xs uppercase tracking-widest hover:bg-white transition-colors disabled:opacity-50"
        >
          {isRunning ? 'SCANNING...' : 'RUN_DIAGNOSTICS'}
        </button>
      </div>

      {/* Overall status */}
      <div className="border-2 border-[#353534] p-6 mb-8 text-center">
        <div className="text-[10px] text-[#a98a7d] font-bold uppercase tracking-widest mb-2">SYSTEM_STATUS</div>
        <div className="text-4xl font-black uppercase tracking-tighter" style={{ color: overallColor }}>
          {overallStatus}
        </div>
        <div className="text-xs font-mono text-[#5a4136] mt-1">
          {operationalCount}/{services.length} services operational
        </div>
      </div>

      {/* Service checks */}
      <div className="space-y-3 mb-8">
        <div className="text-xs font-black uppercase tracking-widest text-[#a98a7d] mb-2">API_SERVICES</div>
        {services.map((svc) => {
          const style = STATUS_STYLES[svc.status];
          return (
            <div key={svc.name} className="border-2 border-[#353534] p-4 flex items-center justify-between hover:bg-[#1c1b1b] transition-colors">
              <div className="flex items-center gap-4">
                <span className={`w-3 h-3 rounded-full shrink-0 ${style.dot}`} />
                <div>
                  <div className="font-mono font-black text-sm">{svc.name}</div>
                  <div className="text-[10px] text-[#5a4136]">{svc.description}</div>
                </div>
              </div>
              <div className="text-right">
                <div className={`text-xs font-black uppercase ${style.color}`}>{style.label}</div>
                {svc.latency !== null && (
                  <div className="text-[10px] font-mono text-[#a98a7d]">{svc.latency}ms</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Environment & storage */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="border-2 border-[#353534] p-4">
          <div className="text-xs font-black uppercase tracking-widest text-[#a98a7d] mb-4">ENVIRONMENT</div>
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-[#353534] pb-2">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${mapboxConfigured ? 'bg-[#13ff43]' : 'bg-red-500'}`} />
                <span className="text-xs font-mono">MAPBOX_TOKEN</span>
              </div>
              <span className={`text-[10px] font-bold uppercase ${mapboxConfigured ? 'text-[#13ff43]' : 'text-red-400'}`}>
                {mapboxConfigured ? 'CONFIGURED' : 'MISSING'}
              </span>
            </div>
            <div className="flex items-center justify-between border-b border-[#353534] pb-2">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${supabaseConfigured ? 'bg-[#13ff43]' : 'bg-amber-500'}`} />
                <span className="text-xs font-mono">SUPABASE_URL</span>
              </div>
              <span className={`text-[10px] font-bold uppercase ${supabaseConfigured ? 'text-[#13ff43]' : 'text-amber-400'}`}>
                {supabaseConfigured ? 'CONFIGURED' : 'NOT_SET'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#13ff43]" />
                <span className="text-xs font-mono">PERSISTENCE</span>
              </div>
              <span className="text-[10px] font-bold uppercase text-[#a98a7d]">
                LOCAL_STORAGE (Phase 1)
              </span>
            </div>
          </div>
        </div>

        <div className="border-2 border-[#353534] p-4">
          <div className="text-xs font-black uppercase tracking-widest text-[#a98a7d] mb-4">STORAGE</div>
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-[#353534] pb-2">
              <span className="text-xs font-mono text-[#5a4136]">TOTAL_USED</span>
              <span className="font-mono font-bold text-[#ffb693]">{storageUsed}</span>
            </div>
            <div className="flex items-center justify-between border-b border-[#353534] pb-2">
              <span className="text-xs font-mono text-[#5a4136]">SAVED_BIDS</span>
              <span className="font-mono font-bold">{bidCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-[#5a4136]">ENGINE</span>
              <span className="font-mono font-bold text-[#a98a7d]">localStorage</span>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
