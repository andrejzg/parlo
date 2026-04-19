import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getPrompts,
  getPrompt,
  savePrompt,
  revertPrompt,
  seedPrompts,
  testGenerate,
  type PromptSummary,
  type PromptDetail,
  type PromptVersion,
} from "@/api/client";
import { captureException } from "@/lib/posthog";

// ── Helpers ───────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Renders prompt content with {{placeholders}} highlighted. */
function PromptPreview({ content }: { content: string }) {
  const parts = content.split(/(\{\{[^}]+\}\})/g);
  return (
    <pre className="whitespace-pre-wrap text-sm font-mono leading-relaxed text-muted-foreground">
      {parts.map((part, i) =>
        /^\{\{[^}]+\}\}$/.test(part) ? (
          <span key={i} className="text-primary font-semibold">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </pre>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────

export default function AdminPage() {
  const [prompts, setPrompts] = useState<PromptSummary[]>([]);
  const [selected, setSelected] = useState<PromptDetail | null>(null);
  const [draft, setDraft] = useState("");
  const [viewingVersion, setViewingVersion] = useState<PromptVersion | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Test panel state
  const [testAudience, setTestAudience] = useState("");
  const [testGather, setTestGather] = useState("");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  // ── Data loading ────────────────────────────────────────────────────

  const loadPrompts = useCallback(async () => {
    try {
      const data = await getPrompts();
      setPrompts(data);
    } catch (e: any) {
      captureException(e, { location: "AdminPage.loadPrompts" });
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  const selectPrompt = useCallback(async (name: string) => {
    setLoading(true);
    setError(null);
    setViewingVersion(null);
    try {
      const detail = await getPrompt(name);
      setSelected(detail);
      setDraft(detail.currentContent);
    } catch (e: any) {
      captureException(e, { location: "AdminPage.selectPrompt", promptName: name });
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      await savePrompt(selected.name, draft);
      const updated = await getPrompt(selected.name);
      setSelected(updated);
      setDraft(updated.currentContent);
      setSuccessMsg("Saved new version");
      setTimeout(() => setSuccessMsg(null), 3000);
      loadPrompts();
    } catch (e: any) {
      captureException(e, { location: "AdminPage.handleSave", promptName: selected?.name });
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRevert = async (version: number) => {
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      await revertPrompt(selected.name, version);
      const updated = await getPrompt(selected.name);
      setSelected(updated);
      setDraft(updated.currentContent);
      setViewingVersion(null);
      setSuccessMsg(`Reverted to v${version}`);
      setTimeout(() => setSuccessMsg(null), 3000);
      loadPrompts();
    } catch (e: any) {
      captureException(e, { location: "AdminPage.handleRevert", promptName: selected?.name, version });
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSeed = async () => {
    setLoading(true);
    setError(null);
    try {
      await seedPrompts();
      await loadPrompts();
      setSuccessMsg("Prompts seeded");
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (e: any) {
      captureException(e, { location: "AdminPage.handleSeed" });
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleTestGenerate = async () => {
    setTestLoading(true);
    setTestResult(null);
    try {
      const res = await testGenerate(testAudience, testGather);
      setTestResult(JSON.stringify(res, null, 2));
    } catch (e: any) {
      captureException(e, { location: "AdminPage.handleTestGenerate" });
      setTestResult(`Error: ${e.message}`);
    } finally {
      setTestLoading(false);
    }
  };

  // ── Template preview with sample replacements ───────────────────────

  const previewContent = useMemo(() => {
    if (!draft) return "";
    return draft
      .replace(/\{\{audience\}\}/g, testAudience || "{{audience}}")
      .replace(/\{\{gather\}\}/g, testGather || "{{gather}}");
  }, [draft, testAudience, testGather]);

  const isDirty = selected && draft !== selected.currentContent;

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border px-6 py-4 flex items-center justify-between">
        <h1 className="font-display text-xl font-bold tracking-tight">
          Parlo <span className="text-primary">Admin</span>
        </h1>
        <Button variant="outline" size="sm" onClick={handleSeed} disabled={loading}>
          Seed Defaults
        </Button>
      </header>

      {/* Feedback bar */}
      {(error || successMsg) && (
        <div
          className={`px-6 py-2 text-sm ${
            error
              ? "bg-destructive/20 text-destructive"
              : "bg-primary/20 text-primary"
          }`}
        >
          {error || successMsg}
        </div>
      )}

      <div className="flex flex-col lg:flex-row">
        {/* ── Sidebar: Prompt List ───────────────────────────────────── */}
        <aside className="lg:w-64 border-b lg:border-b-0 lg:border-r border-border p-4 shrink-0">
          <h2 className="text-xs uppercase tracking-wider text-muted-foreground mb-3 font-semibold">
            Prompts
          </h2>
          {prompts.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No prompts found. Click "Seed Defaults" to initialize.
            </p>
          )}
          <ul className="space-y-1">
            {prompts.map((p) => (
              <li key={p.name}>
                <button
                  onClick={() => selectPrompt(p.name)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                    selected?.name === p.name
                      ? "bg-primary/20 text-primary"
                      : "hover:bg-secondary text-foreground"
                  }`}
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    v{p.currentVersion}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* ── Main Content ──────────────────────────────────────────── */}
        <main className="flex-1 p-6 space-y-6 min-w-0">
          {!selected && !loading && (
            <p className="text-muted-foreground">
              Select a prompt from the sidebar to edit it.
            </p>
          )}

          {loading && !selected && (
            <p className="text-muted-foreground">Loading...</p>
          )}

          {selected && (
            <>
              {/* Editor header */}
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="font-display text-lg font-bold">{selected.name}</h2>
                <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                  v{selected.currentVersion}
                </span>
                {isDirty && (
                  <span className="text-xs text-primary">unsaved changes</span>
                )}
              </div>

              {/* Textarea editor */}
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={14}
                className="w-full rounded-md border border-input bg-background px-4 py-3 text-sm font-mono leading-relaxed ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-y"
                spellCheck={false}
              />

              <div className="flex gap-3">
                <Button onClick={handleSave} disabled={loading || !isDirty}>
                  {loading ? "Saving..." : "Save new version"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setDraft(selected.currentContent);
                    setViewingVersion(null);
                  }}
                  disabled={!isDirty}
                >
                  Discard changes
                </Button>
              </div>

              {/* Template preview */}
              <div className="rounded-md border border-border bg-secondary/30 p-4">
                <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-2 font-semibold">
                  Template Preview
                </h3>
                <PromptPreview
                  content={
                    testAudience || testGather ? previewContent : draft
                  }
                />
              </div>

              {/* Version history */}
              <div>
                <h3 className="text-xs uppercase tracking-wider text-muted-foreground mb-3 font-semibold">
                  Version History
                </h3>
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {(selected.versions ?? [])
                    .slice()
                    .sort((a, b) => b.version - a.version)
                    .map((v) => (
                      <div
                        key={v.version}
                        className={`rounded-md border p-3 text-sm ${
                          viewingVersion?.version === v.version
                            ? "border-primary bg-primary/10"
                            : "border-border bg-secondary/20"
                        }`}
                      >
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="font-medium">v{v.version}</span>
                          <span className="text-muted-foreground text-xs">
                            {fmtDate(v.createdAt)}
                          </span>
                          <span className="text-muted-foreground text-xs">
                            by {v.createdBy}
                          </span>
                          <div className="ml-auto flex gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setViewingVersion(
                                  viewingVersion?.version === v.version ? null : v,
                                )
                              }
                            >
                              {viewingVersion?.version === v.version
                                ? "Hide"
                                : "View"}
                            </Button>
                            {v.version !== selected.currentVersion && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleRevert(v.version)}
                                disabled={loading}
                              >
                                Revert
                              </Button>
                            )}
                          </div>
                        </div>
                        {viewingVersion?.version === v.version && (
                          <div className="mt-3 rounded border border-border bg-background p-3">
                            <PromptPreview content={v.content} />
                          </div>
                        )}
                      </div>
                    ))}
                </div>
              </div>
            </>
          )}

          {/* ── Test Panel ──────────────────────────────────────────── */}
          <div className="rounded-md border border-border p-4 space-y-4">
            <h3 className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              Test Generate
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Audience
                </label>
                <Input
                  value={testAudience}
                  onChange={(e) => setTestAudience(e.target.value)}
                  placeholder="e.g. startup founders"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  Gather
                </label>
                <Input
                  value={testGather}
                  onChange={(e) => setTestGather(e.target.value)}
                  placeholder="e.g. product feedback"
                />
              </div>
            </div>
            <Button
              variant="secondary"
              onClick={handleTestGenerate}
              disabled={testLoading || !testAudience || !testGather}
            >
              {testLoading ? "Generating..." : "Test Generate"}
            </Button>
            {testResult && (
              <pre className="mt-2 rounded-md border border-border bg-background p-3 text-xs font-mono whitespace-pre-wrap max-h-60 overflow-y-auto">
                {testResult}
              </pre>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
