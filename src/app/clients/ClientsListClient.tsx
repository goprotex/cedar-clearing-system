'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { fetchApiAuthed } from '@/lib/auth-client';
import { toast } from 'sonner';
import type { ClientRow } from './types';

export default function ClientsListClient() {
  const router = useRouter();
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsCompany, setNeedsCompany] = useState(false);
  const [q, setQ] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newNotes, setNewNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchApiAuthed('/api/clients');
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to load clients');
        return;
      }
      setNeedsCompany(Boolean(data.needsCompany));
      setClients((data.clients ?? []) as ClientRow[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return clients;
    return clients.filter((c) => {
      const blob = [c.name, c.email, c.phone, c.address].filter(Boolean).join(' ').toLowerCase();
      return blob.includes(s);
    });
  }, [clients, q]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) {
      toast.error('Name is required');
      return;
    }
    setCreating(true);
    try {
      const res = await fetchApiAuthed('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email: newEmail.trim() || undefined,
          phone: newPhone.trim() || undefined,
          address: newAddress.trim() || undefined,
          notes: newNotes || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Could not create client');
        return;
      }
      toast.success('Client created');
      setCreateOpen(false);
      setNewName('');
      setNewEmail('');
      setNewPhone('');
      setNewAddress('');
      setNewNotes('');
      const id = data.client?.id as string | undefined;
      if (id) router.push(`/clients/${id}`);
      else load();
    } finally {
      setCreating(false);
    }
  };

  return (
    <AppShell>
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-end border-l-4 border-[#FF6B00] pl-3 sm:pl-4 mb-8 min-w-0">
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-4xl font-black uppercase tracking-tighter">CLIENTS</h1>
          <p className="text-[#ffb693] text-[10px] sm:text-xs font-mono">
            {needsCompany ? 'NO_COMPANY // LINK PROFILE TO ADD CLIENTS' : `${clients.length} RECORDS`}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 shrink-0 w-full sm:w-auto">
          <Input
            placeholder="SEARCH_NAME_EMAIL_PHONE_ADDRESS"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="border-[#353534] bg-[#1a1a1a] text-[#e5e2e1] font-mono text-xs min-w-0 sm:min-w-[240px]"
          />
          <Button
            type="button"
            disabled={needsCompany}
            onClick={() => setCreateOpen(true)}
            className="bg-[#FF6B00] text-black font-black text-xs uppercase tracking-widest hover:bg-white transition-all px-4 py-2"
          >
            + NEW_CLIENT
          </Button>
        </div>
      </div>

      {needsCompany && (
        <div className="border-2 border-amber-600/50 bg-amber-950/20 p-4 mb-6 text-sm text-[#e5e2e1]">
          <p className="font-bold uppercase tracking-tight mb-1">Company required</p>
          <p className="text-[#a98a7d] text-xs">
            Clients are stored per company. Open Settings and join or create a company, then return here.
          </p>
        </div>
      )}

      {loading ? (
        <p className="text-[10px] font-mono text-[#5a4136]">LOADING…</p>
      ) : filtered.length === 0 ? (
        <div className="border-2 border-[#353534] p-16 text-center">
          <p className="text-4xl mb-3">👤</p>
          <p className="text-lg font-black uppercase tracking-tight">NO_CLIENTS_MATCH</p>
          <p className="text-sm mt-1 text-[#a98a7d]">
            {q ? 'Try a different search or clear the filter.' : 'Create a client to track repeat customers and notes.'}
          </p>
        </div>
      ) : (
        <div className="w-full min-w-0 overflow-x-auto overscroll-x-contain touch-pan-x">
        <div className="min-w-[640px] border-2 border-[#353534]">
          <div className="grid grid-cols-12 gap-4 px-4 py-2 bg-[#2a2a2a] border-b border-[#353534] text-[10px] text-[#a98a7d] font-bold uppercase tracking-widest">
            <div className="col-span-4">Name</div>
            <div className="col-span-3 hidden sm:block">Contact</div>
            <div className="col-span-3 hidden md:block">Address</div>
            <div className="col-span-2 text-right">Updated</div>
          </div>
          {filtered.map((c) => (
            <Link
              key={c.id}
              href={`/clients/${c.id}`}
              className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-[#353534] hover:bg-[#2a2a2a] transition-colors items-start"
            >
              <div className="col-span-12 sm:col-span-4 font-bold text-[#ffb693] truncate">{c.name}</div>
              <div className="col-span-12 sm:col-span-3 text-xs text-[#e5e2e1] hidden sm:block">
                {[c.email, c.phone].filter(Boolean).join(' · ') || '—'}
              </div>
              <div className="col-span-12 md:col-span-3 text-xs text-[#a98a7d] truncate hidden md:block">
                {c.address || '—'}
              </div>
              <div className="col-span-12 sm:col-span-2 text-right text-[10px] font-mono text-[#a98a7d]">
                {c.updated_at ? new Date(c.updated_at).toLocaleDateString() : '—'}
              </div>
            </Link>
          ))}
        </div>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="border-[#353534] bg-[#1a1a1a] text-[#e5e2e1] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#FF6B00] font-black uppercase tracking-tight">New client</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-[10px] uppercase text-[#a98a7d]">Name *</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="mt-1 border-[#353534] bg-[#131313]"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-[10px] uppercase text-[#a98a7d]">Email</Label>
                <Input
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="mt-1 border-[#353534] bg-[#131313]"
                />
              </div>
              <div>
                <Label className="text-[10px] uppercase text-[#a98a7d]">Phone</Label>
                <Input
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="mt-1 border-[#353534] bg-[#131313]"
                />
              </div>
            </div>
            <div>
              <Label className="text-[10px] uppercase text-[#a98a7d]">Address</Label>
              <Input
                value={newAddress}
                onChange={(e) => setNewAddress(e.target.value)}
                className="mt-1 border-[#353534] bg-[#131313]"
              />
            </div>
            <div>
              <Label className="text-[10px] uppercase text-[#a98a7d]">Notes</Label>
              <Textarea
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                rows={3}
                className="mt-1 border-[#353534] bg-[#131313] text-sm"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" type="button" onClick={() => setCreateOpen(false)} className="border-[#353534]">
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="bg-[#FF6B00] text-black font-black uppercase text-xs"
            >
              {creating ? 'Saving…' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
