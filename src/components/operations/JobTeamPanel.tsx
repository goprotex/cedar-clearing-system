'use client';

import { useCallback, useEffect, useState } from 'react';

type Member = { user_id: string; role: 'owner' | 'worker' | 'viewer'; email: string | null; created_at: string };
type PendingInvite = { id: string; email: string; role: string; created_at: string; expires_at: string };

type Props = { jobId: string };

export default function JobTeamPanel({ jobId }: Props) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [pending, setPending] = useState<PendingInvite[]>([]);

  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'worker' | 'viewer'>('worker');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteErr, setInviteErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/team`, { cache: 'no-store', credentials: 'same-origin' });
      if (res.status === 401) {
        setErr('Sign in to view team.');
        setMembers([]);
        setMyRole(null);
        setPending([]);
        return;
      }
      if (res.status === 403) {
        setErr('This job is not on your Supabase account yet. Convert the bid to a job while signed in, then refresh.');
        setMembers([]);
        setMyRole(null);
        setPending([]);
        return;
      }
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || res.statusText);
      }
      const data = (await res.json()) as { myRole: string; members: Member[]; pendingInvites: PendingInvite[] | null };
      setMyRole(data.myRole);
      setMembers(data.members ?? []);
      setPending(data.pendingInvites ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  const sendInvite = async () => {
    setInviteBusy(true);
    setInviteErr(null);
    setInviteLink(null);
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/invites`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), role: inviteRole }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; token?: string };
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      const token = data.token;
      if (!token) throw new Error('No token returned');
      const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/invite/join?token=${encodeURIComponent(token)}`;
      setInviteLink(url);
      setEmail('');
      await load();
    } catch (e) {
      setInviteErr(e instanceof Error ? e.message : String(e));
    } finally {
      setInviteBusy(false);
    }
  };

  const cancelInvite = async (inviteId: string) => {
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/invites`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteId }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(d.error ?? res.statusText);
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const updateRole = async (userId: string, role: string) => {
    if (role !== 'owner' && role !== 'worker' && role !== 'viewer') return;
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/members`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? res.statusText);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const removeMember = async (userId: string) => {
    if (!window.confirm('Remove this person from the job?')) return;
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/members`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? res.statusText);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  if (loading) {
    return <div className="mt-3 pl-2 border-l-2 border-[#353534] text-[10px] font-mono text-[#5a4136]">Loading team…</div>;
  }

  if (err) {
    return (
      <div className="mt-3 pl-2 border-l-2 border-amber-600/50 text-xs text-amber-200/90">
        {err}
      </div>
    );
  }

  const isOwner = myRole === 'owner';

  return (
    <div className="mt-3 pl-2 border-l-2 border-[#FF6B00]/40 space-y-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-[#a98a7d]">Crew</div>
      <ul className="space-y-2">
        {members.map((m) => (
          <li key={m.user_id} className="flex flex-wrap items-center gap-2 text-[11px] font-mono border border-[#353534] px-2 py-1.5">
            <span className="text-[#e5e2e1] truncate flex-1 min-w-0" title={m.email ?? m.user_id}>
              {m.email ?? m.user_id.slice(0, 8)}
            </span>
            {isOwner ? (
              <>
                <select
                  value={m.role}
                  onChange={(e) => void updateRole(m.user_id, e.target.value)}
                  className="bg-[#1a1a1a] border border-[#353534] text-[10px] px-1 py-0.5 text-[#ffb693]"
                >
                  <option value="owner">owner</option>
                  <option value="worker">worker</option>
                  <option value="viewer">viewer</option>
                </select>
                <button
                  type="button"
                  onClick={() => void removeMember(m.user_id)}
                  className="text-[10px] text-red-400 hover:text-red-200"
                >
                  remove
                </button>
              </>
            ) : (
              <span className="text-[#13ff43]">{m.role}</span>
            )}
          </li>
        ))}
      </ul>

      {isOwner && (
        <>
          <div className="text-[10px] font-bold uppercase tracking-widest text-[#a98a7d] pt-1">Invite by email</div>
          <div className="flex flex-wrap gap-2 items-end">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="crew@company.com"
              className="flex-1 min-w-[160px] bg-transparent border border-[#353534] px-2 py-1 text-xs font-mono"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as 'worker' | 'viewer')}
              className="bg-[#1a1a1a] border border-[#353534] text-[10px] px-1 py-1"
            >
              <option value="worker">worker</option>
              <option value="viewer">viewer</option>
            </select>
            <button
              type="button"
              disabled={inviteBusy || !email.trim()}
              onClick={() => void sendInvite()}
              className="bg-[#FF6B00] text-black font-black px-2 py-1 text-[10px] uppercase disabled:opacity-40"
            >
              Invite
            </button>
          </div>
          {inviteErr && <p className="text-[10px] text-red-400">{inviteErr}</p>}
          {inviteLink && (
            <div className="border border-[#13ff43]/30 bg-[#0a1a0f]/40 p-2 space-y-1">
              <div className="text-[9px] text-[#a98a7d] uppercase">One-time link (copy and send)</div>
              <div className="text-[10px] font-mono break-all text-[#13ff43]">{inviteLink}</div>
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(inviteLink)}
                className="text-[10px] border border-[#353534] px-2 py-0.5 hover:border-[#FF6B00]"
              >
                Copy
              </button>
            </div>
          )}

          {pending.length > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-[#a98a7d] mb-1">Pending</div>
              <ul className="space-y-1">
                {pending.map((p) => (
                  <li key={p.id} className="flex justify-between items-center text-[10px] font-mono text-[#5a4136]">
                    <span>{p.email} ({p.role})</span>
                    <button type="button" className="text-red-400/80 hover:text-red-300" onClick={() => void cancelInvite(p.id)}>
                      cancel
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {!isOwner && (
        <p className="text-[10px] text-[#5a4136]">Only owners can invite or change roles.</p>
      )}
    </div>
  );
}
