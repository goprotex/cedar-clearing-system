'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { fetchApiAuthed } from '@/lib/auth-client';
import { formatCurrency } from '@/lib/rates';
import { toast } from 'sonner';
import type { ClientRow } from '../types';

type BidSummary = {
  id: string;
  bid_number: string;
  status: string;
  client_name: string;
  property_name: string;
  total_acreage: number;
  total_amount: number;
  created_at: string;
  updated_at: string;
};

type JobRow = {
  id: string;
  bid_id: string;
  title: string;
  status: string;
  created_at: string;
};

const STATUS_COLORS: Record<string, string> = {
  draft: 'border-[#a98a7d] text-[#a98a7d]',
  sent: 'border-blue-500 text-blue-400',
  accepted: 'border-[#13ff43] text-[#13ff43]',
  declined: 'border-red-500 text-red-400',
  expired: 'border-amber-500 text-amber-400',
};

export default function ClientsDetailClient({ id }: { id: string }) {
  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState<ClientRow | null>(null);
  const [bids, setBids] = useState<BidSummary[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchApiAuthed(`/api/clients/${id}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to load client');
        setClient(null);
        return;
      }
      const c = data.client as ClientRow;
      setClient(c);
      setBids((data.bids ?? []) as BidSummary[]);
      setJobs((data.jobs ?? []) as JobRow[]);
      setName(c.name);
      setEmail(c.email ?? '');
      setPhone(c.phone ?? '');
      setAddress(c.address ?? '');
      setNotes(c.notes ?? '');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const jobsByBid = useMemo(() => {
    const m = new Map<string, JobRow[]>();
    for (const j of jobs) {
      const list = m.get(j.bid_id) ?? [];
      list.push(j);
      m.set(j.bid_id, list);
    }
    return m;
  }, [jobs]);

  const save = async () => {
    const n = name.trim();
    if (!n) {
      toast.error('Name is required');
      return;
    }
    setSaving(true);
    try {
      const res = await fetchApiAuthed(`/api/clients/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: n,
          email: email.trim() || null,
          phone: phone.trim() || null,
          address: address.trim() || null,
          notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Save failed');
        return;
      }
      toast.success('Saved');
      if (data.client) setClient(data.client as ClientRow);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <p className="text-[10px] font-mono text-[#5a4136]">LOADING…</p>
      </AppShell>
    );
  }

  if (!client) {
    return (
      <AppShell>
        <p className="text-[#a98a7d]">Client not found or access denied.</p>
        <Link href="/clients" className="text-[#FF6B00] text-sm mt-4 inline-block">
          ← Back to clients
        </Link>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
        <Link href="/clients" className="text-[10px] font-mono text-[#a98a7d] hover:text-[#FF6B00]">
          ← CLIENTS
        </Link>
        <Button
          type="button"
          onClick={save}
          disabled={saving}
          className="bg-[#FF6B00] text-black font-black text-xs uppercase self-start sm:self-auto"
        >
          {saving ? 'SAVING…' : 'SAVE'}
        </Button>
      </div>

      <div className="border-l-4 border-[#FF6B00] pl-3 sm:pl-4 mb-8">
        <h1 className="text-2xl sm:text-3xl font-black uppercase tracking-tighter truncate">{client.name}</h1>
        <p className="text-[10px] font-mono text-[#a98a7d]">ID {client.id}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-10">
        <div className="space-y-3 border-2 border-[#353534] p-4">
          <h2 className="text-xs font-black uppercase tracking-widest text-[#FF6B00]">Contact</h2>
          <div>
            <Label className="text-[10px] uppercase text-[#a98a7d]">Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 border-[#353534] bg-[#131313]"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-[10px] uppercase text-[#a98a7d]">Email</Label>
              <Input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 border-[#353534] bg-[#131313]"
              />
            </div>
            <div>
              <Label className="text-[10px] uppercase text-[#a98a7d]">Phone</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1 border-[#353534] bg-[#131313]"
              />
            </div>
          </div>
          <div>
            <Label className="text-[10px] uppercase text-[#a98a7d]">Address</Label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="mt-1 border-[#353534] bg-[#131313]"
            />
          </div>
        </div>

        <div className="space-y-3 border-2 border-[#353534] p-4">
          <h2 className="text-xs font-black uppercase tracking-widest text-[#FF6B00]">CRM notes</h2>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={10}
            placeholder="Sales follow-up, land access, preferences…"
            className="border-[#353534] bg-[#131313] text-sm min-h-[200px]"
          />
        </div>
      </div>

      <div className="border-2 border-[#353534] mb-6">
        <div className="px-4 py-2 bg-[#2a2a2a] border-b border-[#353534] text-xs font-black uppercase tracking-widest text-[#ffb693]">
          Bid history ({bids.length})
        </div>
        {bids.length === 0 ? (
          <div className="p-8 text-center text-[#a98a7d] text-sm">
            No bids linked yet. In the estimator, choose a <span className="text-[#e5e2e1]">CRM client</span> on the bid.
          </div>
        ) : (
          <>
            <div className="hidden md:grid grid-cols-12 gap-2 px-4 py-2 text-[10px] text-[#a98a7d] font-bold uppercase border-b border-[#353534]">
              <div className="col-span-2">Bid</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-3">Property</div>
              <div className="col-span-2 text-right">Amount</div>
              <div className="col-span-3">Jobs</div>
            </div>
            {bids.map((b) => {
              const linked = jobsByBid.get(b.id) ?? [];
              return (
                <div
                  key={b.id}
                  className="grid grid-cols-1 md:grid-cols-12 gap-2 px-4 py-3 border-b border-[#353534] hover:bg-[#2a2a2a]/50"
                >
                  <div className="md:col-span-2 font-mono text-[#ffb693]">
                    <Link href={`/bid/${b.id}`} className="hover:underline">
                      {b.bid_number}
                    </Link>
                  </div>
                  <div className="md:col-span-2">
                    <span
                      className={`border px-2 py-0.5 text-[10px] font-black uppercase ${
                        STATUS_COLORS[b.status] || 'border-[#353534] text-[#a98a7d]'
                      }`}
                    >
                      {b.status}
                    </span>
                  </div>
                  <div className="md:col-span-3 text-sm truncate">{b.property_name || '—'}</div>
                  <div className="md:col-span-2 text-right text-sm font-mono">{formatCurrency(Number(b.total_amount) || 0)}</div>
                  <div className="md:col-span-3 text-xs">
                    {linked.length === 0 ? (
                      <span className="text-[#5a4136]">No job</span>
                    ) : (
                      <ul className="space-y-1">
                        {linked.map((j) => (
                          <li key={j.id}>
                            <Link href={`/job/${j.id}`} className="text-[#13ff43] hover:underline">
                              {j.title}
                            </Link>
                            <span className="text-[#5a4136] ml-1">({j.status})</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </AppShell>
  );
}
