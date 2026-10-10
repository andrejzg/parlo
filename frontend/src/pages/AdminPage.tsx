import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
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

/** Uppercase section label (Prompts, Template Preview, Version History, Test Generate). */
const SECTION_LABEL = "font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground";

/** Version chip; pair with `bg-badge text-badge-foreground` (current) or `bg-muted text-neutral-8`. */
const VERSION_CHIP = "rounded-full px-s py-xxs font-data text-xxs font-medium";

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
function PromptPreview({ content, className }: { content: string; className?: string }) {
  const parts = content.split(/(\{\{[^}]+\}\})/g);
  return (
    <pre className={cn("whitespace-pre-wrap rounded-s bg-card p-s font-data text-xs text-neutral-8", className)}>
      {parts.map((part, i) =>
        /^\{\{[^}]+\}\}$/.test(part) ? (
          <span key={i} className="font-medium text-color-1">
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
      <header className="flex items-center justify-between px-l py-m shadow-edge-b">
        <h1 className="font-brand text-l font-heavy text-foreground">Parlo Admin</h1>
        <Button variant="outline" size="sm" onClick={handleSeed} disabled={loading}>
          Seed Defaults
        </Button>
      </header>

      {/* Feedback bar */}
      {(error || successMsg) && (
        <div
          className={`px-l py-xs text-s ${
            error
              ? "bg-error-transparent text-error"
              : "bg-success-transparent text-success"
          }`}
        >
          {error || successMsg}
        </div>
      )}

      <div className="flex flex-col lg:flex-row">
        {/* ── Sidebar: Prompt List ───────────────────────────────────── */}
        <aside className="shrink-0 p-m shadow-edge-b lg:w-64 lg:shadow-edge-r">
          <h2 className={`${SECTION_LABEL} mb-s`}>
            Prompts
          </h2>
          {prompts.length === 0 && (
            <p className="text-s text-muted-foreground">
              No prompts found. Click "Seed Defaults" to initialize.
            </p>
          )}
          <ul className="space-y-xxs">
            {prompts.map((p) => (
              <li key={p.name}>
                <button
                  type="button"
                  onClick={() => selectPrompt(p.name)}
                  className={`w-full rounded-s px-s py-xs text-left text-s transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring ${
                    selected?.name === p.name
                      ? "bg-color-1-transparent text-color-1"
                      : "text-foreground hover:bg-accent"
                  }`}
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="ml-xs text-xs text-muted-foreground">
                    v{p.currentVersion}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* ── Main Content ──────────────────────────────────────────── */}
        <main className="min-w-0 flex-1 space-y-l p-l">
          {!selected && !loading && (
            <p className="text-m text-muted-foreground">
              Select a prompt from the sidebar to edit it.
            </p>
          )}

          {loading && !selected && (
            <p className="text-m text-muted-foreground">Loading...</p>
          )}

          {selected && (
            <>
              {/* Editor header */}
              <div className="flex flex-wrap items-center gap-s">
                <h2 className="font-brand text-l font-heavy text-foreground">{selected.name}</h2>
                <span className={`${VERSION_CHIP} bg-badge text-badge-foreground`}>
                  v{selected.currentVersion}
                </span>
                {isDirty && (
                  <span className="text-xs text-color-1">unsaved changes</span>
                )}
              </div>

              {/* Textarea editor — prompts are code-like, so the data role replaces monospace. */}
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={14}
                className="min-h-[12rem] resize-y whitespace-pre-wrap font-data text-s"
                spellCheck={false}
              />

              <div className="flex gap-s">
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
              <div>
                <h3 className={`${SECTION_LABEL} mb-xs`}>
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
                <h3 className={`${SECTION_LABEL} mb-s`}>
                  Version History
                </h3>
                <div className="max-h-80 space-y-xs overflow-y-auto">
                  {(selected.versions ?? [])
                    .slice()
                    .sort((a, b) => b.version - a.version)
                    .map((v) => {
                      const isViewing = viewingVersion?.version === v.version;
                      const isCurrent = v.version === selected.currentVersion;
                      return (
                        <div
                          key={v.version}
                          className={`rounded-s bg-card px-m py-s text-s${isViewing ? " shadow-edge-accent" : ""}`}
                        >
                          <div className="flex flex-wrap items-center gap-s">
                            <span
                              className={`${VERSION_CHIP} ${
                                isCurrent ? "bg-badge text-badge-foreground" : "bg-muted text-neutral-8"
                              }`}
                            >
                              v{v.version}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {fmtDate(v.createdAt)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              by {v.createdBy}
                            </span>
                            <div className="ml-auto flex gap-xs">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setViewingVersion(isViewing ? null : v)
                                }
                              >
                                {isViewing ? "Hide" : "View"}
                              </Button>
                              {!isCurrent && (
                                <Button
                                  variant="destructive"
                                  size="sm"
                                  onClick={() => handleRevert(v.version)}
                                  disabled={loading}
                                >
                                  Revert
                                </Button>
                              )}
                            </div>
                          </div>
                          {isViewing && (
                            <PromptPreview content={v.content} className="mt-s bg-background" />
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            </>
          )}

          {/* ── Test Panel ──────────────────────────────────────────── */}
          <div className="space-y-m rounded-s bg-card p-m">
            <h3 className={SECTION_LABEL}>
              Test Generate
            </h3>
            <div className="grid grid-cols-1 gap-m md:grid-cols-2">
              <div>
                <Label htmlFor="admin-test-audience" className="mb-xxs block">
                  Audience
                </Label>
                <Input
                  id="admin-test-audience"
                  value={testAudience}
                  onChange={(e) => setTestAudience(e.target.value)}
                  placeholder="e.g. startup founders"
                />
              </div>
              <div>
                <Label htmlFor="admin-test-gather" className="mb-xxs block">
                  Gather
                </Label>
                <Input
                  id="admin-test-gather"
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
              <pre className="max-h-60 overflow-y-auto whitespace-pre-wrap rounded-s bg-background p-s font-data text-xs text-neutral-8">
                {testResult}
              </pre>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
