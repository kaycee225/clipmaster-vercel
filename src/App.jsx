import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Plus, X, Cloud, Copy, Download, Trash2, AlertCircle, Check, Pencil,
  Zap, AlignJustify, FileText, ChevronUp, ChevronDown, Layers, Eraser, ClipboardCopy, Search, Upload,
} from "lucide-react";
import Floaters from "./components/Floaters.jsx";
import CloudPanel from "./components/CloudPanel.jsx";
import SegmentCard from "./components/SegmentCard.jsx";
import { sb, isSupabaseConfigured } from "./lib/supabase.js";

const CLIENT_ID = Math.random().toString(36).slice(2);
const uid = () => Math.random().toString(36).slice(2, 10);
const FIRST = "--- [Paste #1] ---\n\n";
// Accepts "===== Name =====" (your original format) and "=== [Tab: Name] ==="
const TAB_RE = /^(?:=== \[Tab: (.*?)\] ===|={3,}[ \t]*([^=\s].*?)[ \t]*={3,})[ \t]*$/gm;

// Every tab is its own segmented buffer: "--- [Paste #n] ---" markers split it into segments.
const normalize = (c) => {
  if (/--- \[Paste #\d+\] ---/.test(c)) return c;
  const t = (c || "").trim();
  return t ? `--- [Paste #1] ---\n\n${t}\n\n--- [Paste #2] ---\n\n` : FIRST;
};
const newTab = (name, content = FIRST) => ({ id: uid(), name, content: normalize(content) });
const getFragments = (text) =>
  text.split(/--- \[Paste #\d+\] ---/g).map(s => s.trim()).filter(Boolean);

const serialize = (tabs) => tabs.map(t => `===== ${t.name} =====\n\n${t.content}`).join("\n\n");
function parseTabs(text) {
  const m = [...text.matchAll(TAB_RE)];
  if (!m.length) return null;
  return m.map((x, i) => {
    const start = x.index + x[0].length;
    const end = i + 1 < m.length ? m[i + 1].index : text.length;
    return newTab((x[1] ?? x[2] ?? "").trim() || `Tab ${i + 1}`, text.slice(start, end).replace(/^\n+/, ""));
  });
}
function download(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
const safeName = (s) => (s || "tab").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || "tab";
const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

function getWorkspaceId() {
  const url = new URL(location.href);
  let w = url.searchParams.get("w");
  if (!w) {
    w = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    url.searchParams.set("w", w);
    history.replaceState(null, "", url);
  }
  return w;
}

const PILL = "inline-flex items-center gap-2 px-4 py-2.5 rounded-full font-semibold text-xs sm:text-sm transition-all hover:scale-105";
const SYNC_DOT = {
  loading: "var(--accent)", saving: "var(--accent)", pending: "var(--accent)",
  saved: "var(--mint)", error: "var(--destructive)",
};

export default function App() {
  const [wsId, setWsId] = useState(getWorkspaceId);
  const [tabs, setTabs] = useState([newTab("Tab 1")]);
  const [activeId, setActiveId] = useState(null);
  const [status, setStatus] = useState("loading");
  const [flash, setFlash] = useState(null); // { msg, type } shown in the footer status pill
  const [error, setError] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [autoSync, setAutoSync] = useState(true);
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedClean, setCopiedClean] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [renamingId, setRenamingId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const timer = useRef(null), flashTimer = useRef(null), loaded = useRef(false);
  const taRef = useRef(null), pendingCursor = useRef(null);
  const tabsRef = useRef(tabs), dirty = useRef(false);

  const active = tabs.find(t => t.id === activeId) || tabs[0];
  const frags = useMemo(() => getFragments(active.content), [active.content]);
  const q = searchQuery.trim().toLowerCase();
  const searchResults = useMemo(() => q
    ? tabs.map(t => ({
        tab: t,
        frags: getFragments(t.content).map((text, index) => ({ text, index })).filter(f => f.text.toLowerCase().includes(q)),
      })).filter(r => r.frags.length > 0 || r.tab.name.toLowerCase().includes(q))
    : [], [tabs, q]);
  const openResult = (tabId, index) => {
    setActiveId(tabId); setSearchQuery("");
    if (index != null) setTimeout(() => go(`seg-${index}`), 80);
  };
  const say = useCallback((msg, type = "success") => {
    setFlash({ msg, type });
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 2800);
  }, []);

  useLayoutEffect(() => {
    if (pendingCursor.current != null && taRef.current) {
      taRef.current.setSelectionRange(pendingCursor.current, pendingCursor.current);
      pendingCursor.current = null;
    }
  });

  // ---- load + realtime cross-sync
  useEffect(() => {
    loaded.current = false; setStatus("loading");
    let cancelled = false;
    const fix = (arr) => arr.map(t => ({ ...t, content: normalize(t.content) }));
    (async () => {
      const { data, error } = await sb.from("workspaces").select("tabs").eq("id", wsId).maybeSingle();
      if (cancelled) return;
      if (error) { setStatus("error"); setError(`Load failed: ${error.message}`); say(`Load failed: ${error.message}`, "error"); }
      if (data?.tabs?.length) { const t = fix(data.tabs); tabsRef.current = t; setTabs(t); setActiveId(t[0].id); }
      else { const t = [newTab("Tab 1")]; tabsRef.current = t; setTabs(t); setActiveId(t[0].id); }
      if (!error) setStatus("saved");
      loaded.current = true;
    })();
    const ch = sb.channel(`ws-${wsId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "workspaces", filter: `id=eq.${wsId}` }, (p) => {
        const row = p.new;
        if (!row || row.writer === CLIENT_ID || !row.tabs?.length) return;
        const t = fix(row.tabs);
        tabsRef.current = t;
        setTabs(t);
        setActiveId(cur => t.some(x => x.id === cur) ? cur : t[0].id);
        setStatus("saved");
      }).subscribe();
    return () => { cancelled = true; sb.removeChannel(ch); };
  }, [wsId, say]);

  const save = useCallback(async (next) => {
    setStatus("saving");
    dirty.current = false;
    const { error } = await sb.from("workspaces").upsert({ id: wsId, tabs: next, writer: CLIENT_ID, updated_at: new Date().toISOString() });
    if (error) { setStatus("error"); say(`Sync failed: ${error.message}`, "error"); } else { setStatus("saved"); setError(null); }
  }, [wsId, say]);

  const commit = (next) => {
    tabsRef.current = next;
    setTabs(next);
    if (!loaded.current) return;
    dirty.current = true;
    clearTimeout(timer.current);
    if (autoSync) {
      setStatus("saving");
      timer.current = setTimeout(() => save(next), 1200);
    } else {
      setStatus("pending");
    }
  };
  const setActiveContent = (content) => commit(tabs.map(t => t.id === active.id ? { ...t, content } : t));

  // Save right away (used by "Sync Now" and when the editor loses focus)
  const flush = () => {
    if (!loaded.current || !dirty.current) return;
    clearTimeout(timer.current);
    save(tabsRef.current);
  };
  const syncNow = () => {
    clearTimeout(timer.current);
    save(tabsRef.current);
    say("Synced to cloud!");
  };

  // ---- AUTO-SEGMENT: a paste (jump of >5 chars) drops a new marker after the pasted text
  const onEditorChange = (e) => {
    const ta = e.target;
    let next = ta.value;
    const prev = active.content;
    if (next.length > prev.length + 5) {
      const total = (next.match(/\[Paste #\d+\]/g) || []).length;
      const marker = `\n\n--- [Paste #${total + 1}] ---\n\n`;
      const cursor = ta.selectionStart;
      next = next.slice(0, cursor) + marker + next.slice(cursor);
      pendingCursor.current = cursor + marker.length;
      say("Auto-marked segment!", "info");
    }
    setActiveContent(next);
  };

  // ---- tab actions
  const addTab = () => { const t = newTab(`Tab ${tabs.length + 1}`); commit([...tabs, t]); setActiveId(t.id); say("New tab created!"); };
  const removeTab = (id) => {
    const t = tabs.find(x => x.id === id);
    if (getFragments(t.content).length && !confirm(`Delete "${t.name}" and its segments?`)) return;
    const next = tabs.filter(x => x.id !== id);
    const final = next.length ? next : [newTab("Tab 1")];
    commit(final); if (id === active.id) setActiveId(final[0].id);
    say("Tab deleted", "info");
  };
  const clearTab = () => {
    if (frags.length && !confirm(`Clear all segments in "${active.name}"?`)) return;
    setActiveContent(FIRST); say("Tab cleared!", "info");
  };
  const addImported = (parsed) => {
    commit([...tabs, ...parsed]); setActiveId(parsed[0].id);
    say(`Created ${parsed.length} tab${parsed.length > 1 ? "s" : ""}`);
  };

  // ---- copy / download
  const copy = (text, msg) =>
    navigator.clipboard.writeText(text).then(() => say(msg)).catch(() => say("Copy failed", "error"));
  const flashBtn = (set) => { set(true); setTimeout(() => set(false), 1500); };
  const copyAllContent = () => { copy(active.content, "Full content copied!"); flashBtn(setCopiedAll); };
  const copyClean = () => { copy(frags.join("\n"), "Clean copy done!"); flashBtn(setCopiedClean); };
  const copyCleanSpaced = () => copy(frags.join("\n\n"), "Clean copy (blank line) done!");
  const copyCleanOneLine = () => copy(frags.map(f => f.replace(/\s+/g, " ").trim()).join(" ").replace(/\s+/g, " ").trim(), "Clean copy (single line) done!");
  const copyAllTabs = () => copy(serialize(tabs), `Copied all ${tabs.length} tab${tabs.length === 1 ? "" : "s"}!`);
  const dlTab = () => { download(`${safeName(active.name)}.txt`, active.content); say("Tab downloaded as .txt"); };
  const dlAll = () => { download(`${safeName(wsId)}-all-tabs.txt`, serialize(tabs)); say(`Downloaded ${tabs.length} tab${tabs.length === 1 ? "" : "s"} as .txt`); };
  const dlSegment = (i) => { download(`${safeName(active.name)}-seg${i + 1}.txt`, frags[i] ?? ""); say("Segment downloaded as .txt"); };

  const onPaste = (e) => {
    const parsed = parseTabs(e.clipboardData.getData("text"));
    if (parsed) { e.preventDefault(); addImported(parsed); }
  };
  const runImport = () => {
    addImported(parseTabs(importText) || [newTab(`Tab ${tabs.length + 1}`, importText)]);
    setImportText(""); setImportOpen(false);
  };

  const switchWorkspace = () => {
    const w = prompt("Workspace ID (leave blank for a new one):", wsId);
    if (w === null) return;
    const url = new URL(location.href);
    url.searchParams.set("w", w.trim() || crypto.randomUUID().replace(/-/g, "").slice(0, 16));
    history.replaceState(null, "", url); setWsId(url.searchParams.get("w"));
    setPanelOpen(false);
  };

  const scrollToTop = () => taRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  const scrollToBottom = () => taRef.current?.scrollTo({ top: taRef.current.scrollHeight, behavior: "smooth" });

  const statusText = { loading: "Loading…", saving: "Saving…", pending: "Unsynced changes", saved: "Synced", error: "Sync error" }[status];

  return (
    <div className="relative z-10 min-h-screen px-4 pb-28 sm:px-6 sm:pb-28 md:px-10 md:pb-28" id="top">
      <Floaters />

      {/* Floating scroll nav */}
      <div className="fixed bottom-5 right-4 flex flex-col gap-2 z-40 opacity-60 hover:opacity-100 transition-opacity sm:bottom-8 sm:right-8">
        <button
          onClick={scrollToTop}
          className="p-3 text-white rounded-full shadow-lg flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, var(--primary), var(--rose))" }}
          title="Jump to Top"
        >
          <ChevronUp className="w-4 h-4" />
        </button>
        <button
          onClick={scrollToBottom}
          className="p-3 text-white rounded-full shadow-lg flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, var(--secondary), var(--primary))" }}
          title="Jump to Bottom"
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>

      <CloudPanel
        open={panelOpen}
        autoSync={autoSync}
        onToggleAutoSync={setAutoSync}
        onSyncNow={syncNow}
        onClose={() => setPanelOpen(false)}
        wsId={wsId}
        onCopyLink={() => copy(location.href, "Workspace link copied — open it anywhere to sync")}
        onSwitch={switchWorkspace}
        isCloudConnected={isSupabaseConfigured}
      />

      <main className="max-w-7xl mx-auto flex flex-col gap-6 sm:gap-8">
        {/* Header */}
        <header
          className="relative rounded-[2rem] border border-[rgba(228,214,247,0.7)] bg-white/70 backdrop-blur-sm p-5 sm:p-8 shadow-xl flex flex-col gap-5"
        >
          {/* Sticker decorations */}
          <div
            className="pony-sticker pony-pop-in"
            style={{
              width: 44, height: 44,
              background: "linear-gradient(145deg,#FFDA82,#FFB020)",
              color: "#5B3B00",
              transform: "rotate(-14deg)",
              top: "-1rem", left: "-0.75rem",
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="#5B3B00" stroke="#5B3B00" strokeWidth={2.25}>
              <path d="M12 2l2.9 6.6L22 9.3l-5 4.9 1.2 7.1L12 17.8l-6.2 3.5L7 14.2 2 9.3l7.1-.7z" />
            </svg>
          </div>
          <div
            className="pony-sticker pony-pop-in hidden sm:flex"
            style={{
              width: 56, height: 56,
              background: "linear-gradient(145deg,#FFFFFF,#F1E6FF)",
              color: "#402C55",
              transform: "rotate(8deg)",
              top: "-1.25rem", right: "-1rem",
            }}
          >
            <svg viewBox="0 0 64 40" style={{ width: "70%", height: "70%" }} fill="none">
              <path d="M4 38a28 28 0 0 1 56 0" stroke="#FF7FB4" strokeWidth={6} strokeLinecap="round" />
              <path d="M12 38a20 20 0 0 1 40 0" stroke="#FFC24B" strokeWidth={6} strokeLinecap="round" />
              <path d="M20 38a12 12 0 0 1 24 0" stroke="#4FB6E0" strokeWidth={6} strokeLinecap="round" />
            </svg>
          </div>

          {/* Title row */}
          <div className="flex items-center gap-3">
            <div
              className="shrink-0 grid place-items-center w-12 h-12 rounded-2xl text-white shadow-md"
              style={{ background: "linear-gradient(135deg, var(--primary), var(--rose))" }}
            >
              <Zap className="w-6 h-6" />
            </div>
            <div>
              <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight m-0">
                ClipMaster <span style={{ color: "var(--primary)" }}>Pro</span>
              </h1>
              <p className="text-[var(--muted-foreground)] font-medium text-sm mt-0.5 m-0">
                Smart cloud-sync scrapbook with tabs for your clipboard.
              </p>
            </div>
          </div>

          {/* Action pills */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setPanelOpen(true)}
              className={`${PILL} bg-white border border-[var(--border)] text-[rgba(64,44,85,0.7)] shadow-sm hover:shadow-md`}
            >
              <Cloud className="w-4 h-4" style={{ color: "var(--secondary)" }} />
              Cloud Options
            </button>
            <button
              onClick={copyClean}
              className={PILL}
              style={{ background: "rgba(184,95,204,0.1)", color: "var(--primary)" }}
            >
              {copiedClean ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copiedClean ? "Copied!" : "Copy Clean"}
            </button>
            <button
              onClick={copyCleanSpaced}
              className={PILL}
              style={{ background: "rgba(79,182,224,0.15)", color: "var(--secondary-foreground)" }}
            >
              <AlignJustify className="w-4 h-4" />
              Copy Clean (1 space)
            </button>
            <button
              onClick={copyCleanOneLine}
              className={PILL}
              style={{ background: "rgba(63,207,158,0.15)", color: "var(--mint-foreground)" }}
            >
              <FileText className="w-4 h-4" />
              Copy (no newlines)
            </button>
            <button
              onClick={dlTab}
              className={`${PILL} text-white shadow-md`}
              style={{ background: "linear-gradient(90deg, var(--accent), #ffb830)" }}
            >
              <Download className="w-4 h-4" />
              Download .txt
            </button>
            <button
              onClick={dlAll}
              className={`${PILL} text-white shadow-md`}
              style={{ background: "linear-gradient(90deg, var(--secondary), var(--mint))" }}
            >
              <Layers className="w-4 h-4" />
              Download All Tabs
            </button>
            <button
              onClick={copyAllTabs}
              className={`${PILL} text-white shadow-md`}
              style={{ background: "linear-gradient(90deg, var(--mint), var(--secondary))" }}
            >
              <ClipboardCopy className="w-4 h-4" />
              Copy All Tabs
            </button>
            <button
              onClick={() => setImportOpen(true)}
              className={`${PILL} text-white shadow-md`}
              style={{ background: "linear-gradient(90deg, var(--accent), var(--secondary))" }}
            >
              <Upload className="w-4 h-4" />
              Import Tabs
            </button>
            <button
              onClick={clearTab}
              className={PILL}
              style={{ background: "rgba(232,87,122,0.12)", color: "var(--destructive)" }}
            >
              <Eraser className="w-4 h-4" />
              Clear Tab
            </button>
            <button
              onClick={copyAllContent}
              className={`${PILL} text-white shadow-md`}
              style={{ background: "linear-gradient(90deg, var(--primary), var(--rose))" }}
            >
              {copiedAll ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {copiedAll ? "Copied!" : "Copy All"}
            </button>
          </div>

          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted-foreground)] pointer-events-none" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tabs and segments…"
              className="w-full pl-11 pr-10 py-3 text-sm bg-white/80 border border-[var(--border)] rounded-2xl focus:outline-none focus:ring-2 focus:ring-[rgba(184,95,204,0.3)] placeholder:text-[var(--muted-foreground)] transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </header>

        {/* Search results panel */}
        {q && (
          <div className="rounded-[1.5rem] bg-white/70 border border-[var(--border)] p-5 shadow-md">
            {searchResults.length === 0 ? (
              <div className="text-center py-8 text-sm text-[var(--muted-foreground)]">No matching tabs or segments found.</div>
            ) : (
              <div className="flex flex-col gap-4">
                {searchResults.map((r) => (
                  <div key={r.tab.id} className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.tab.id === active.id ? "var(--primary)" : "var(--border)" }} />
                      <button
                        onClick={() => openResult(r.tab.id)}
                        className="text-sm font-bold text-[var(--foreground)] hover:text-[var(--primary)] transition-colors text-left"
                      >
                        {r.tab.name}
                      </button>
                      <span className="text-[10px] text-[var(--muted-foreground)]">
                        {r.frags.length} match{r.frags.length === 1 ? "" : "es"}
                      </span>
                    </div>
                    {r.frags.map((f) => (
                      <button
                        key={f.index}
                        onClick={() => openResult(r.tab.id, f.index)}
                        className="text-left px-3 py-2 rounded-xl bg-white/60 border border-[var(--border)] text-xs text-[var(--muted-foreground)] hover:border-[rgba(184,95,204,0.4)] hover:bg-white transition-all [overflow-wrap:anywhere]"
                      >
                        <span className="font-mono text-[10px] text-[var(--primary)] mr-2">#{f.index + 1}</span>
                        {f.text.slice(0, 120)}{f.text.length > 120 ? "…" : ""}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tabs bar */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {(q ? tabs.filter(t => t.name.toLowerCase().includes(q)) : tabs).map((t) => {
            const isActive = t.id === active.id;
            return (
              <div
                key={t.id}
                onClick={() => setActiveId(t.id)}
                className={[
                  "group relative flex items-center gap-2 pl-3 pr-2 py-2.5 rounded-2xl cursor-pointer whitespace-nowrap transition-all border",
                  isActive
                    ? "bg-white border-[rgba(184,95,204,0.3)] text-[var(--foreground)] shadow-md"
                    : "bg-white/40 border-transparent text-[var(--muted-foreground)] hover:bg-white/70",
                ].join(" ")}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: isActive ? "var(--primary)" : "var(--border)" }}
                />
                {renamingId === t.id ? (
                  <input
                    autoFocus
                    defaultValue={t.name}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => { commit(tabs.map(x => x.id === t.id ? { ...x, name: e.target.value.trim() || x.name } : x)); setRenamingId(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") setRenamingId(null); }}
                    className="w-28 px-2 py-1 text-sm bg-white border border-[rgba(184,95,204,0.5)] rounded-lg focus:outline-none"
                  />
                ) : (
                  <span
                    onDoubleClick={(e) => { e.stopPropagation(); setRenamingId(t.id); }}
                    className="text-sm font-semibold max-w-[160px] truncate"
                    title={`${t.name} (double-click to rename)`}
                  >
                    {t.name}
                  </span>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); setRenamingId(t.id); }}
                  className="ml-1 p-0.5 rounded text-[var(--muted-foreground)] hover:text-[var(--primary)] hover:bg-[rgba(184,95,204,0.1)] transition-colors"
                  title="Rename"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); removeTab(t.id); }}
                  className="p-0.5 rounded text-[var(--muted-foreground)] hover:text-[var(--destructive)] hover:bg-[rgba(232,87,122,0.1)] transition-colors"
                  title="Delete tab"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}

          {/* New tab button */}
          <button
            onClick={addTab}
            className="flex items-center gap-1.5 shrink-0 px-3 py-2.5 rounded-2xl text-sm font-semibold text-white shadow-md transition-transform hover:scale-105 active:scale-95"
            style={{ background: "linear-gradient(135deg, var(--primary), var(--rose))" }}
            title="New tab"
          >
            <Plus className="w-4 h-4" />
            New Tab
          </button>
        </div>

        {/* Error banner */}
        {error && (
          <div className="flex items-start gap-2 px-4 py-3 rounded-2xl bg-[rgba(232,87,122,0.1)] border border-[rgba(232,87,122,0.3)] text-[var(--destructive)] text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Editor + Segments grid */}
        <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-6 sm:gap-8">
          {/* Master input */}
          <section className="flex flex-col gap-3 min-w-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
                  {active.name} — Master Input
                </span>
                <button onClick={scrollToTop} className="p-1 rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
                  <ChevronUp className="w-3 h-3" />
                </button>
                <button onClick={scrollToBottom} className="p-1 rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
                  <ChevronDown className="w-3 h-3" />
                </button>
              </div>
              <span className="font-mono text-[10px] text-[var(--muted-foreground)]">
                {active.content.length.toLocaleString()} chars · {frags.length} segment{frags.length === 1 ? "" : "s"}
              </span>
            </div>
            <textarea
              ref={taRef}
              value={active.content}
              onChange={onEditorChange}
              onPaste={onPaste}
              onBlur={flush}
              placeholder="Paste items here to auto-index them..."
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
              className="w-full max-w-full h-[50vh] sm:h-[55vh] p-5 sm:p-8 bg-white/90 border-2 border-[var(--border)] rounded-[1.75rem] outline-none font-mono text-sm whitespace-pre-wrap [overflow-wrap:anywhere] text-[rgba(64,44,85,0.9)] resize-none shadow-sm transition-all focus:shadow-[0_0_0_4px_rgba(184,95,204,0.18)] focus:border-[rgba(184,95,204,0.5)] placeholder:text-[rgba(124,104,146,0.6)]"
            />
          </section>

          {/* Segmented library */}
          <section className="flex flex-col gap-3 min-w-0">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--muted-foreground)]">
              Segmented Library
            </span>
            <div className="flex flex-col gap-5 h-[50vh] sm:h-[55vh] overflow-y-auto pr-1 pt-2">
              {frags.length === 0 ? (
                <div className="m-auto text-center p-8 border-2 border-dashed border-[var(--border)] rounded-[1.75rem] text-[var(--muted-foreground)]">
                  <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" style={{ color: "var(--primary)" }} />
                  <p className="text-sm">No segments detected yet.</p>
                </div>
              ) : (
                frags.map((f, i) => (
                  <SegmentCard
                    key={i}
                    index={i}
                    total={frags.length}
                    fragment={f}
                    onCopy={() => copy(f, "Segment copied!")}
                    onGo={go}
                    onDownload={() => dlSegment(i)}
                  />
                ))
              )}
            </div>
          </section>
        </div>

        {/* Footer */}
        <footer className="flex flex-col gap-3 justify-between items-center border-t border-[rgba(228,214,247,0.7)] pt-6">
          {/* Sync + counts */}
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-1 text-xs font-semibold text-[var(--muted-foreground)]">
            <span className="flex items-center">
              <i className="inline-block w-2 h-2 rounded-full mr-2" style={{ background: SYNC_DOT[status] }} />
              {statusText}
            </span>
            <span>
              {frags.length} segment{frags.length !== 1 ? "s" : ""} in this tab · {tabs.length} tab{tabs.length !== 1 ? "s" : ""}
            </span>
          </div>
          {/* Status pill */}
          <div
            className={[
              "status-pill",
              flash ? "show" : "",
              flash ? flash.type : "",
            ].join(" ")}
          >
            {flash?.type === "success" && <Check className="w-3.5 h-3.5" />}
            {flash?.type === "error" && <AlertCircle className="w-3.5 h-3.5" />}
            {flash?.type === "info" && <Zap className="w-3.5 h-3.5" />}
            <span>{flash?.msg ?? "Status"}</span>
          </div>
          <button
            onClick={() => removeTab(active.id)}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-[var(--muted-foreground)] rounded-xl hover:text-[var(--destructive)] hover:bg-[rgba(232,87,122,0.1)] transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Delete Current Tab
          </button>
        </footer>
      </main>

      {/* Paste-tabs modal */}
      {importOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-4 bg-[rgba(64,44,85,0.35)] backdrop-blur-[4px]"
          onClick={() => setImportOpen(false)}
        >
          <div
            className="w-full max-w-[40rem] flex flex-col gap-3 rounded-[2rem] border border-[rgba(228,214,247,0.7)] bg-white/95 p-5 sm:p-8 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="grid place-items-center w-9 h-9 rounded-xl text-white"
                  style={{ background: "linear-gradient(135deg, var(--accent), var(--secondary))" }}
                >
                  <Upload className="w-4 h-4" />
                </div>
                <h2 className="text-lg font-bold text-[var(--foreground)] m-0">Import Tabs</h2>
              </div>
              <button onClick={() => setImportOpen(false)} className="p-1.5 rounded-lg text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="m-0 text-sm text-[var(--muted-foreground)]">
              Paste the text you copied with “Copy All Tabs” to recreate all tabs here. Plain text becomes one tab.
            </p>
            <textarea
              autoFocus
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder="Paste your copied tabs here…"
              spellCheck={false}
              className="w-full h-48 p-4 placeholder:text-[rgba(124,104,146,0.6)] bg-white/90 border-2 border-[var(--border)] rounded-[1.25rem] outline-none font-mono text-sm whitespace-pre-wrap [overflow-wrap:anywhere] text-[rgba(64,44,85,0.9)] resize-none shadow-sm transition-all focus:shadow-[0_0_0_4px_rgba(184,95,204,0.18)] focus:border-[rgba(184,95,204,0.5)]"
            />
            <div className="flex flex-wrap justify-end gap-2">
              <button
                onClick={() => setImportOpen(false)}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={!importText.trim()}
                onClick={runImport}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white shadow-md transition-all hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
                style={{ background: "linear-gradient(90deg, var(--accent), var(--secondary))" }}
              >
                <Upload className="w-4 h-4" />
                Import Tabs
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
