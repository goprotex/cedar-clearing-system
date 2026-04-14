'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchApiAuthed } from '@/lib/auth-client';

type Member = { user_id: string; role: 'owner' | 'worker' | 'viewer'; email: string | null; created_at: string };
type PendingInvite = { id: string; email: string; role: string; created_at: string; expires_at: string };

type Props = { jobId: string };

export default function JobTeamPanel({ jobId }: Props) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [canManageTeam, setCanManageTeam] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [pending, setPending] = useState<PendingInvite[]>([]);

  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'worker' | 'viewer'>('worker');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteErr, setInviteErr] = useState<string | null>(null);

  // Account invite state (for new users who don't have an account yet)
  const [acctEmail, setAcctEmail] = useState('');
  const [acctName, setAcctName] = useState('');
  const [acctRole, setAcctRole] = useState('operator');
  const [acctBusy, setAcctBusy] = useState(false);
  const [acctMsg, setAcctMsg] = useState<string | null>(null);
  const [acctErr, setAcctErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetchApiAuthed(`/api/jobs/${encodeURIComponent(jobId)}/team`);
      if (res.status === 401) {
        setErr('Sign in to view team.');
        setMembers([]);
        setMyRole(null);
        setCanManageTeam(false);
        setPending([]);
        return;
      }
      if (res.status === 403) {
        setErr('This job is not on your Supabase account yet. Convert the bid to a job while signed in, then refresh.');
        setMembers([]);
        setMyRole(null);
        setCanManageTeam(false);
        setPending([]);
        return;
      }
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || res.statusText);
      }
      const data = (await res.json()) as {
        myRole: string | null;
        canManageTeam?: boolean;
        members: Member[];
        pendingInvites: PendingInvite[] | null;
      };
      setMyRole(data.myRole);
      setCanManageTeam(Boolean(data.canManageTeam));
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
      const res = await fetchApiAuthed(`/api/jobs/${encodeURIComponent(jobId)}/invites`, {
        method: 'POST',
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
      const res = await fetchApiAuthed(`/api/jobs/${encodeURIComponent(jobId)}/invites`, {
        method: 'DELETE',
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
      const res = await fetchApiAuthed(`/api/jobs/${encodeURIComponent(jobId)}/members`, {
        method: 'PATCH',
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
      const res = await fetchApiAuthed(`/api/jobs/${encodeURIComponent(jobId)}/members`, {
        method: 'DELETE',
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

  const sendAccountInvite = async () => {
    setAcctBusy(true);
    setAcctErr(null);
    setAcctMsg(null);
    try {
      const res = await fetchApiAuthed('/api/company/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: acctEmail.trim(),
          role: acctRole,
          fullName: acctName.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      setAcctMsg(data.message ?? 'Invite sent!');
      setAcctEmail('');
      setAcctName('');
    } catch (e) {
      setAcctErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAcctBusy(false);
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

  const canEdit = canManageTeam;

  return (
    <div className="mt-3 pl-2 border-l-2 border-[#FF6B00]/40 space-y-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-[#a98a7d]">Crew</div>
      <ul className="space-y-2">
        {members.map((m) => (
          <li key={m.user_id} className="flex flex-wrap items-center gap-2 text-[11px] font-mono border border-[#353534] px-2 py-1.5">
            <span className="text-[#e5e2e1] truncate flex-1 min-w-0" title={m.email ?? m.user_id}>
              {m.email ?? m.user_id.slice(0, 8)}
            </span>
            {canEdit ? (
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

      {canEdit && (
        <>
          <div className="text-[10px] font-bold uppercase tracking-widest text-[#a98a7d] pt-1">Invite to job (existing user)</div>
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

          {/* Send account invite email for new users */}
          <div className="border-t border-[#353534] pt-3 mt-1 space-y-2">
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#a98a7d]">
              Invite new user (send account email)
            </div>
            <p className="text-[9px] text-[#5a4136]">
              Person doesn&apos;t have a Cedar account yet? Send them a signup email. Once they create their account, invite them to this job above.
            </p>
            <div className="flex flex-wrap gap-2 items-end">
              <input
                type="email"
                value={acctEmail}
                onChange={(e) => setAcctEmail(e.target.value)}
                placeholder="newuser@company.com"
                className="flex-1 min-w-[140px] bg-transparent border border-[#353534] px-2 py-1 text-xs font-mono"
              />
              <input
                type="text"
                value={acctName}
                onChange={(e) => setAcctName(e.target.value)}
                placeholder="Full name (optional)"
                className="flex-1 min-w-[120px] bg-transparent border border-[#353534] px-2 py-1 text-xs font-mono"
              />
              <select
                value={acctRole}
                onChange={(e) => setAcctRole(e.target.value)}
                className="bg-[#1a1a1a] border border-[#353534] text-[10px] px-1 py-1"
              >
                <option value="operator">operator</option>
                <option value="crew_lead">crew lead</option>
                <option value="manager">manager</option>
                <option value="viewer">viewer</option>
              </select>
              <button
                type="button"
                disabled={acctBusy || !acctEmail.trim()}
                onClick={() => void sendAccountInvite()}
                className="bg-cyan-600 text-black font-black px-2 py-1 text-[10px] uppercase disabled:opacity-40"
              >
                Send email
              </button>
            </div>
            {acctErr && <p className="text-[10px] text-red-400">{acctErr}</p>}
            {acctMsg && (
              <div className="border border-[#13ff43]/30 bg-[#0a1a0f]/40 p-2 text-[10px] text-[#13ff43]">
                {acctMsg}
              </div>
            )}
          </div>
        </>
      )}

      {!canEdit && (
        <p className="text-[10px] text-[#5a4136]">Only job owners or company managers can invite or change crew roles.</p>
      )}
    </div>
  );
}
