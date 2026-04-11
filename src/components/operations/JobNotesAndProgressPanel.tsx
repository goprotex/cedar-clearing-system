'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/utils/supabase/client';
import { fetchApiAuthed } from '@/lib/auth-client';
import type { ActiveJobSummary } from '@/lib/active-jobs';

type NoteRow = {
  id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  body: string;
  attachments: Array<{ url: string; kind?: string; name?: string }>;
};

type Props = {
  job: ActiveJobSummary;
  onJobPatch?: (patch: Partial<ActiveJobSummary>) => void;
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function JobNotesAndProgressPanel({ job, onJobPatch }: Props) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteRow[]>([]);

  const [workStart, setWorkStart] = useState('');
  const [workEnd, setWorkEnd] = useState('');
  const [machineHrs, setMachineHrs] = useState('');
  const [fuelGal, setFuelGal] = useState('');
  const [savingProgress, setSavingProgress] = useState(false);

  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingUrls, setPendingUrls] = useState<Array<{ url: string; kind: 'image' | 'pdf'; name: string }>>([]);

  useEffect(() => {
    setWorkStart(job.work_started_at ? job.work_started_at.slice(0, 16) : '');
    setWorkEnd(job.work_completed_at ? job.work_completed_at.slice(0, 16) : '');
    setMachineHrs(
      job.manual_machine_hours !== null && job.manual_machine_hours !== undefined
        ? String(job.manual_machine_hours)
        : '',
    );
    setFuelGal(
      job.manual_fuel_gallons !== null && job.manual_fuel_gallons !== undefined
        ? String(job.manual_fuel_gallons)
        : '',
    );
  }, [
    job.id,
    job.work_started_at,
    job.work_completed_at,
    job.manual_machine_hours,
    job.manual_fuel_gallons,
  ]);

  const loadNotes = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetchApiAuthed(`/api/jobs/${encodeURIComponent(job.id)}/notes`);
      if (res.status === 401) {
        setErr('Sign in to load notes.');
        setNotes([]);
        return;
      }
      if (res.status === 403) {
        setErr('You do not have access to this job in Supabase yet.');
        setNotes([]);
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { notes: NoteRow[] };
      setNotes(data.notes ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [job.id]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  const saveProgress = async () => {
    setSavingProgress(true);
    setErr(null);
    try {
      const res = await fetchApiAuthed(`/api/jobs/${encodeURIComponent(job.id)}/progress`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_started_at: workStart ? new Date(workStart).toISOString() : null,
          work_completed_at: workEnd ? new Date(workEnd).toISOString() : null,
          manual_machine_hours: machineHrs.trim() === '' ? null : Number(machineHrs),
          manual_fuel_gallons: fuelGal.trim() === '' ? null : Number(fuelGal),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; job?: ActiveJobSummary };
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      if (data.job) {
        onJobPatch?.({
          work_started_at: data.job.work_started_at as string | null,
          work_completed_at: data.job.work_completed_at as string | null,
          manual_machine_hours: data.job.manual_machine_hours as number | null,
          manual_fuel_gallons: data.job.manual_fuel_gallons as number | null,
        });
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingProgress(false);
    }
  };

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setErr(null);
    try {
      const supabase = createClient();
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user?.id;
      if (!uid) throw new Error('Sign in to upload');

      const next: Array<{ url: string; kind: 'image' | 'pdf'; name: string }> = [...pendingUrls];
      for (const file of Array.from(files)) {
        const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
        const path = `${job.id}/${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: upErr } = await supabase.storage.from('job-media').upload(path, file, {
          upsert: false,
          contentType: file.type || undefined,
        });
        if (upErr) throw new Error(upErr.message);
        const { data: pub } = supabase.storage.from('job-media').getPublicUrl(path);
        const isPdf = file.type === 'application/pdf' || ext === 'pdf';
        next.push({
          url: pub.publicUrl,
          kind: isPdf ? 'pdf' : 'image',
          name: file.name,
        });
      }
      setPendingUrls(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const postNote = async () => {
    const text = draft.trim();
    if (!text && pendingUrls.length === 0) return;
    setPosting(true);
    setErr(null);
    try {
      const res = await fetchApiAuthed(`/api/jobs/${encodeURIComponent(job.id)}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: text, attachments: pendingUrls }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      setDraft('');
      setPendingUrls([]);
      await loadNotes();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPosting(false);
    }
  };

  const deleteNote = async (noteId: string) => {
    if (!window.confirm('Delete this note?')) return;
    try {
      const res = await fetchApiAuthed(
        `/api/jobs/${encodeURIComponent(job.id)}/notes/${encodeURIComponent(noteId)}`,
        { method: 'DELETE' },
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      await loadNotes();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="mt-3 space-y-4 border-t border-[#353534] pt-3">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-[#a98a7d] mb-2">Progress &amp; hours</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
          <div>
            <label className="text-[9px] text-[#5a4136] uppercase block mb-0.5">Work start</label>
            <input
              type="datetime-local"
              value={workStart}
              onChange={(e) => setWorkStart(e.target.value)}
              className="w-full bg-[#1a1a1a] border border-[#353534] px-2 py-1 font-mono text-[#e5e2e1]"
            />
          </div>
          <div>
            <label className="text-[9px] text-[#5a4136] uppercase block mb-0.5">Work end</label>
            <input
              type="datetime-local"
              value={workEnd}
              onChange={(e) => setWorkEnd(e.target.value)}
              className="w-full bg-[#1a1a1a] border border-[#353534] px-2 py-1 font-mono text-[#e5e2e1]"
            />
          </div>
          <div>
            <label className="text-[9px] text-[#5a4136] uppercase block mb-0.5">Machine hours (manual)</label>
            <input
              type="number"
              step="0.1"
              min="0"
              value={machineHrs}
              onChange={(e) => setMachineHrs(e.target.value)}
              className="w-full bg-transparent border border-[#353534] px-2 py-1 font-mono"
              placeholder="e.g. 12.5"
            />
          </div>
          <div>
            <label className="text-[9px] text-[#5a4136] uppercase block mb-0.5">Fuel (gal, manual)</label>
            <input
              type="number"
              step="0.1"
              min="0"
              value={fuelGal}
              onChange={(e) => setFuelGal(e.target.value)}
              className="w-full bg-transparent border border-[#353534] px-2 py-1 font-mono"
              placeholder="e.g. 45"
            />
          </div>
        </div>
        <button
          type="button"
          disabled={savingProgress}
          onClick={() => void saveProgress()}
          className="mt-2 text-[10px] font-black uppercase tracking-wider bg-[#FF6B00] text-black px-3 py-1.5 hover:bg-white disabled:opacity-40"
        >
          {savingProgress ? 'Saving…' : 'Save progress'}
        </button>
      </div>

      <div>
        <div className="text-[10px] font-bold uppercase tracking-widest text-[#a98a7d] mb-2">Job notes &amp; photos</div>
        {loading && <div className="text-[10px] font-mono text-[#5a4136]">Loading notes…</div>}
        {err && <div className="text-xs text-amber-200/90 mb-2">{err}</div>}

        <ul className="space-y-3 max-h-[320px] overflow-y-auto pr-1 mb-3">
          {notes.map((n) => (
            <li key={n.id} className="border border-[#353534] p-2 text-[11px]">
              <div className="flex justify-between gap-2 text-[9px] font-mono text-[#5a4136]">
                <span>{fmtDate(n.created_at)}</span>
                <button type="button" className="text-red-400/90 hover:text-red-300" onClick={() => void deleteNote(n.id)}>
                  delete
                </button>
              </div>
              {n.body ? <p className="text-[#e5e2e1] whitespace-pre-wrap mt-1">{n.body}</p> : null}
              {n.attachments?.length ? (
                <div className="flex flex-wrap gap-2 mt-2">
                  {n.attachments.map((a, i) =>
                    a.kind === 'pdf' ? (
                      <a
                        key={i}
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-[#FF6B00] underline"
                      >
                        {a.name || 'PDF'}
                      </a>
                    ) : (
                      <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className="block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={a.url} alt="" className="max-h-28 rounded border border-[#353534]" />
                      </a>
                    ),
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>

        {pendingUrls.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {pendingUrls.map((a, i) => (
              <span key={i} className="text-[9px] font-mono text-[#13ff43] truncate max-w-[140px]" title={a.name}>
                {a.name}
              </span>
            ))}
          </div>
        )}

        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Update the crew…"
          rows={3}
          className="w-full bg-transparent border border-[#353534] px-2 py-2 text-xs font-mono mb-2"
        />
        <div className="flex flex-wrap gap-2 items-center">
          <label className="text-[10px] font-mono border border-[#353534] px-2 py-1 cursor-pointer hover:border-[#FF6B00]">
            {uploading ? 'Uploading…' : 'Add photos / PDF'}
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
              className="hidden"
              disabled={uploading || posting}
              onChange={(e) => void addFiles(e.target.files)}
            />
          </label>
          <button
            type="button"
            disabled={posting || uploading}
            onClick={() => void postNote()}
            className="text-[10px] font-black uppercase tracking-wider bg-[#13ff43] text-black px-3 py-1.5 hover:bg-white disabled:opacity-40"
          >
            {posting ? 'Posting…' : 'Post note'}
          </button>
        </div>
      </div>
    </div>
  );
}
