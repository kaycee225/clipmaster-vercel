import { Cloud, X, Upload, Link2, ArrowLeftRight } from 'lucide-react';

export default function CloudPanel({
  open,
  autoSync,
  onToggleAutoSync,
  onSyncNow,
  onClose,
  wsId,
  onCopyLink,
  onSwitch,
  isCloudConnected = false,
}) {
  return (
    <>
      {/* Overlay (mobile only) */}
      {open && <div className="fixed inset-0 z-40 bg-[rgba(64,44,85,0.2)] backdrop-blur-[1px] sm:hidden" onClick={onClose} />}

      <div
        className={[
          'fixed z-50 bg-white shadow-2xl',
          'inset-x-0 bottom-0 rounded-t-[2rem] border-t border-[var(--border)]',
          'sm:inset-x-auto sm:top-0 sm:right-0 sm:bottom-0 sm:h-full sm:w-96 sm:rounded-l-[2rem] sm:rounded-t-none sm:border-l sm:border-t-0',
          'flex flex-col gap-4 p-6 max-h-[85vh] overflow-y-auto',
          'transition-transform duration-300 ease-in-out',
          open ? 'translate-y-0 sm:translate-x-0' : 'translate-y-full sm:translate-y-0 sm:translate-x-full',
        ].join(' ')}
      >
        <div className="mx-auto h-1.5 w-12 rounded-full bg-[var(--border)] sm:hidden" />

        <div className="flex items-center justify-between border-b border-[rgba(228,214,247,0.7)] pb-4">
          <div className="flex items-center gap-2">
            <Cloud className="w-5 h-5 text-[var(--primary)]" />
            <h3 className="font-display font-bold text-lg m-0">Cloud Sync</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-col gap-3 text-sm flex-grow">
          <div className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 ${isCloudConnected ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-purple-50 text-purple-700 border border-purple-200'}`}>
            <span className={`w-2 h-2 rounded-full ${isCloudConnected ? 'bg-emerald-500' : 'bg-purple-500'}`} />
            <span>{isCloudConnected ? 'Connected to Supabase' : 'Local Storage Mode (Vercel ready)'}</span>
          </div>
          <p className="text-[var(--muted-foreground)] leading-relaxed m-0 text-xs">
            {isCloudConnected
              ? 'Your tabs sync to the cloud by workspace link. Open the link on any device to pick up where you left off.'
              : 'Workspaces are saved locally in this browser. To enable cross-device cloud sync on Vercel, set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'}
          </p>

          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">Workspace</span>
            <input
              readOnly
              value={wsId}
              title="Workspace ID"
              onClick={(e) => e.target.select()}
              className="w-full px-4 py-2.5 rounded-full border border-[var(--border)] bg-white font-mono text-xs text-[var(--muted-foreground)] outline-none"
            />
            <div className="flex gap-2">
              <button
                onClick={onCopyLink}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full font-semibold text-xs bg-white border border-[var(--border)] text-[rgba(64,44,85,0.7)] shadow-sm transition-all hover:shadow-md"
              >
                <Link2 className="w-4 h-4" style={{ color: 'var(--secondary)' }} />
                Copy link
              </button>
              <button
                onClick={onSwitch}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full font-semibold text-xs bg-white border border-[var(--border)] text-[rgba(64,44,85,0.7)] shadow-sm transition-all hover:shadow-md"
              >
                <ArrowLeftRight className="w-4 h-4" style={{ color: 'var(--primary)' }} />
                Switch
              </button>
            </div>
          </div>

          <div className="mt-2 pt-4 border-t border-[rgba(228,214,247,0.7)]">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={autoSync}
                onChange={(e) => onToggleAutoSync(e.target.checked)}
                className="w-4 h-4 accent-[var(--primary)] rounded"
              />
              <span className="font-semibold text-[rgba(64,44,85,0.8)]">Enable Auto-Sync</span>
            </label>
            <p className="text-[11px] text-[var(--muted-foreground)] ml-7 mt-0.5">
              Saves your tabs automatically when typing pauses.
            </p>
          </div>

          <button
            onClick={onSyncNow}
            className="mt-4 w-full py-3 text-white font-semibold rounded-2xl flex items-center justify-center gap-2 shadow-md transition-transform active:scale-95"
            style={{ background: 'linear-gradient(90deg, var(--primary), var(--rose))' }}
          >
            <Upload className="w-4 h-4" />
            Sync Now
          </button>
        </div>
      </div>
    </>
  );
}
