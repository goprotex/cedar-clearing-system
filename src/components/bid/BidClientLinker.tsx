'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useBidStore } from '@/lib/store';
import { fetchApiAuthed } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

type ClientOption = { id: string; name: string };

export default function BidClientLinker() {
  const { currentBid, updateBidField } = useBidStore();
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsCompany, setNeedsCompany] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const loadClients = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchApiAuthed('/api/clients');
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Could not load clients');
        return;
      }
      setNeedsCompany(Boolean(data.needsCompany));
      const rows = (data.clients ?? []) as { id: string; name: string }[];
      setClients(rows.map((r) => ({ id: r.id, name: r.name })));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  const selectValue = currentBid.clientId ?? '';

  const applyClientRow = (row: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
  }) => {
    if (row.name) updateBidField('clientName', row.name);
    if (row.email != null) updateBidField('clientEmail', row.email ?? '');
    if (row.phone != null) updateBidField('clientPhone', row.phone ?? '');
    if (row.address != null) updateBidField('clientAddress', row.address ?? '');
  };

  const handleSelect = async (value: string) => {
    if (value === '__none' || value === '') {
      updateBidField('clientId', null);
      return;
    }
    updateBidField('clientId', value);
    const res = await fetchApiAuthed(`/api/clients/${value}`);
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error ?? 'Could not load client');
      return;
    }
    if (data.client) applyClientRow(data.client);
  };

  const handleCreate = async () => {
    const name = newName.trim() || currentBid.clientName.trim();
    if (!name) {
      toast.error('Enter a client name');
      return;
    }
    setCreating(true);
    try {
      const res = await fetchApiAuthed('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email: currentBid.clientEmail.trim() || undefined,
          phone: currentBid.clientPhone.trim() || undefined,
          address: currentBid.clientAddress.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Could not create client');
        return;
      }
      const c = data.client as { id: string; name: string; email?: string | null; phone?: string | null; address?: string | null };
      updateBidField('clientId', c.id);
      applyClientRow(c);
      setCreateOpen(false);
      setNewName('');
      await loadClients();
      toast.success('Client linked');
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <p className="text-[10px] font-mono text-[#5a4136] mb-3">LOADING_CRM…</p>
    );
  }

  if (needsCompany) {
    return (
      <div className="mb-3 rounded border border-amber-700/40 bg-amber-950/20 px-3 py-2 text-[10px] text-[#e5e2e1]">
        <span className="text-[#a98a7d]">CRM clients require a company. </span>
        <Link href="/settings" className="text-[#FF6B00] font-bold hover:underline">
          Settings
        </Link>
      </div>
    );
  }

  return (
    <div className="mb-3 space-y-2">
      <Label className="text-[10px] text-[#a98a7d] uppercase tracking-widest">CRM client</Label>
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <Select value={selectValue || '__none'} onValueChange={handleSelect}>
          <SelectTrigger className="h-8 text-sm bg-[#201f1f] border-[#353534] text-[#e5e2e1] focus:border-[#FF6B00] sm:min-w-[200px]">
            <SelectValue placeholder="Link to saved client" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">— No CRM link —</SelectItem>
            {currentBid.clientId && !clients.some((c) => c.id === currentBid.clientId) ? (
              <SelectItem value={currentBid.clientId}>
                (linked — refresh list)
              </SelectItem>
            ) : null}
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-[10px] font-bold uppercase border-[#353534] text-[#13ff43] shrink-0"
          onClick={() => {
            setNewName(currentBid.clientName);
            setCreateOpen(true);
          }}
        >
          + Create &amp; link
        </Button>
        {currentBid.clientId ? (
          <Link
            href={`/clients/${currentBid.clientId}`}
            className="text-[10px] font-mono text-[#FF6B00] hover:underline shrink-0"
          >
            Open profile →
          </Link>
        ) : null}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="border-[#353534] bg-[#1a1a1a] text-[#e5e2e1] max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#FF6B00] font-black uppercase text-sm">Create client &amp; link bid</DialogTitle>
          </DialogHeader>
          <div>
            <Label className="text-[10px] uppercase text-[#a98a7d]">Name</Label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Uses bid client name if empty"
              className="mt-1 border-[#353534] bg-[#131313]"
            />
          </div>
          <p className="text-[10px] text-[#a98a7d]">
            Contact fields on this bid are copied to the new client record.
          </p>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="border-[#353534]" onClick={() => setCreateOpen(false)}>
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
    </div>
  );
}
