import React, { useEffect, useState } from 'react';

interface DspPreset { name: string }

export interface AudioViewerProps {
  audioId: string;
  name: string;
  project: string;
  session: string;
}

/**
 * Audio artifact player: plays a generated voiceover / SFX / music clip, with a DSP-preset
 * A/B picker (apply_audio_dsp) — the same shared presets across voice, SFX, and music.
 * Self-contained; talks to /api/audio + /api/dsp-presets + /api/apply-audio-dsp.
 */
export const AudioViewer: React.FC<AudioViewerProps> = ({ audioId, name, project, session }) => {
  const q = `project=${encodeURIComponent(project)}&session=${encodeURIComponent(session)}`;
  const [currentId, setCurrentId] = useState(audioId);
  const [presets, setPresets] = useState<string[]>([]);
  const [preset, setPreset] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { setCurrentId(audioId); }, [audioId]);
  useEffect(() => {
    fetch(`/api/dsp-presets?${q}`).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d?.presets) setPresets(d.presets); }).catch(() => {});
  }, [q]);

  const src = `/api/audio/${encodeURIComponent(currentId)}/content?${q}`;

  const applyPreset = async () => {
    if (!preset) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/apply-audio-dsp?${q}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioId, preset }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed');
      setCurrentId(j.audio.id);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{name}</h2>
      </div>
      <div className="flex-1 min-h-0 overflow-auto flex flex-col items-center justify-center gap-4 p-6">
        <audio key={src} controls src={src} className="w-full max-w-md" />
        <div className="flex items-center gap-2 text-xs">
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
            className="px-2 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          >
            <option value="">DSP preset…</option>
            {presets.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <button
            onClick={applyPreset}
            disabled={!preset || busy}
            className="px-3 py-1.5 rounded bg-info-600 text-white hover:bg-info-700 disabled:opacity-50"
          >{busy ? 'Applying…' : 'Apply effect'}</button>
          <a href={src} download className="px-3 py-1.5 text-info-600 dark:text-info-400 hover:underline">Download</a>
        </div>
        {currentId !== audioId && <p className="text-xs text-gray-500">Playing processed clip ({preset}) — saved as a new artifact.</p>}
        {err && <p className="text-xs text-red-500">{err}</p>}
      </div>
    </div>
  );
};

export default AudioViewer;
