'use client';

import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import AppShell from '@/components/AppShell';

const MapContainer = dynamic(() => import('@/components/map/MapContainer'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-[#0e0e0e] flex items-center justify-center text-[#a98a7d]">
      <div className="text-center">
        <div className="text-[#FF6B00] text-xl font-black uppercase tracking-widest mb-2">LOADING_MAP</div>
        <div className="text-xs font-mono">INITIALIZING SATELLITE FEED...</div>
      </div>
    </div>
  ),
});

interface ReconNote {
  id: string;
  lng: number;
  lat: number;
  text: string;
  timestamp: string;
}

const STORAGE_KEY = 'ccc_recon_notes';

function loadNotes(): ReconNote[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch { /* fall through */ }
  }
  return [];
}

function saveNotes(notes: ReconNote[]) {
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  }
}

export default function MapRadarClient() {
  const [notes, setNotes] = useState<ReconNote[]>(loadNotes);
  const [newNote, setNewNote] = useState('');
  const [coords, setCoords] = useState({ lng: -99.1403, lat: 30.0469 });
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || '';

  const addNote = useCallback(() => {
    if (!newNote.trim()) return;
    const note: ReconNote = {
      id: `recon-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      lng: coords.lng,
      lat: coords.lat,
      text: newNote.trim(),
      timestamp: new Date().toISOString(),
    };
    const updated = [note, ...notes];
    setNotes(updated);
    saveNotes(updated);
    setNewNote('');
  }, [newNote, coords, notes]);

  const removeNote = useCallback((id: string) => {
    const updated = notes.filter((n) => n.id !== id);
    setNotes(updated);
    saveNotes(updated);
  }, [notes]);

  return (
    <AppShell>
      <div className="flex justify-between items-end border-l-4 border-[#FF6B00] pl-4 mb-6">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-tighter">RADAR</h1>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Map */}
        <div className="flex-1 border-2 border-[#353534] relative" style={{ minHeight: '60vh' }}>
          {mapboxToken ? (
            <MapContainer accessToken={mapboxToken} />
          ) : (
            <div className="w-full h-full min-h-[60vh] bg-[#0e0e0e] flex items-center justify-center text-[#a98a7d]">
              <div className="text-center space-y-2 border-2 border-[#353534] p-8">
                <p className="text-lg font-black uppercase tracking-tighter">SATELLITE_FEED_OFFLINE</p>
                <p className="text-sm font-mono">
                  Add <code className="bg-[#353534] px-1.5 py-0.5 text-[#FF6B00]">NEXT_PUBLIC_MAPBOX_TOKEN</code> to your{' '}
                  <code className="bg-[#353534] px-1.5 py-0.5 text-[#FF6B00]">.env.local</code> file
                </p>
                <div className="flex items-center justify-center gap-2 mt-4">
                  <span className="w-2 h-2 bg-red-500 animate-pulse" />
                  <span className="text-[10px] text-red-400 font-black uppercase">SIGNAL_LOST</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Recon panel */}
        <div className="w-full lg:w-80 shrink-0 space-y-4">
          {/* Coordinate readout */}
          <div className="border-2 border-[#353534] p-4">
            <div className="text-[10px] text-[#a98a7d] font-bold uppercase tracking-widest mb-2">COORDINATES</div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[9px] text-[#5a4136] uppercase">LNG</div>
                <input
                  type="number"
                  step="0.0001"
                  value={coords.lng}
                  onChange={(e) => setCoords((c) => ({ ...c, lng: parseFloat(e.target.value) || 0 }))}
                  className="bg-transparent border border-[#353534] px-2 py-1 text-xs font-mono text-[#ffb693] w-full focus:border-[#FF6B00] outline-none"
                />
              </div>
              <div>
                <div className="text-[9px] text-[#5a4136] uppercase">LAT</div>
                <input
                  type="number"
                  step="0.0001"
                  value={coords.lat}
                  onChange={(e) => setCoords((c) => ({ ...c, lat: parseFloat(e.target.value) || 0 }))}
                  className="bg-transparent border border-[#353534] px-2 py-1 text-xs font-mono text-[#ffb693] w-full focus:border-[#FF6B00] outline-none"
                />
              </div>
            </div>
          </div>

          {/* Add note */}
          <div className="border-2 border-[#353534] p-4">
            <div className="text-[10px] text-[#a98a7d] font-bold uppercase tracking-widest mb-2">RECON_NOTE</div>
            <textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Log observation..."
              className="bg-transparent border border-[#353534] px-2 py-1.5 text-xs font-mono text-[#e5e2e1] placeholder:text-[#5a4136] w-full h-20 resize-none focus:border-[#FF6B00] outline-none mb-2"
            />
            <button
              onClick={addNote}
              disabled={!newNote.trim()}
              className="w-full bg-[#FF6B00] text-black font-black py-2 text-xs uppercase tracking-widest hover:bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              LOG_NOTE
            </button>
          </div>

          {/* Notes list */}
          <div className="border-2 border-[#353534] p-4 max-h-[40vh] overflow-y-auto">
            <div className="text-[10px] text-[#a98a7d] font-bold uppercase tracking-widest mb-3">
              FIELD_LOG ({notes.length})
            </div>
            {notes.length === 0 ? (
              <div className="text-center py-6 text-[#5a4136] text-xs">
                <p className="text-2xl mb-1">🛰️</p>
                <p>NO_OBSERVATIONS_LOGGED</p>
              </div>
            ) : (
              <div className="space-y-2">
                {notes.map((note) => (
                  <div key={note.id} className="border border-[#353534] p-2 group">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs text-[#e5e2e1] flex-1">{note.text}</p>
                      <button
                        onClick={() => removeNote(note.id)}
                        className="text-[10px] text-[#5a4136] hover:text-red-500 font-bold shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        ×
                      </button>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[9px] font-mono text-[#5a4136]">
                        {note.lng.toFixed(4)}, {note.lat.toFixed(4)}
                      </span>
                      <span className="text-[9px] font-mono text-[#5a4136]">
                        {new Date(note.timestamp).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
