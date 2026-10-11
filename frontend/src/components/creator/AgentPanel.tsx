import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, Check, Download, ExternalLink, FileText, LoaderCircle, Plug, Plus, RefreshCw, Send, Sparkles, Trash2, Upload, X } from "lucide-react";
import {
  addConnection,
  approveRound,
  downloadAnswersCsv,
  fetchAgent,
  proposeRound,
  rejectRound,
  removeConnection,
  runAgentDigest,
  runAgentExport,
  updateAgentSettings,
  updateGroupSettings,
  type AgentConnection,
  type AgentSnapshot,
  type GroupRound,
  type GroupVisibility,
  type RoundKind,
} from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Markdown } from "@/lib/markdown";
import { visibilityCopy } from "@/lib/visibility";
import { transitionLarge, transitionSmall } from "@/lib/animations";
import { trackEvent } from "@/lib/posthog";
import { toast } from "@/components/ui/sonner";

interface AgentPanelProps {
  apiKey: string;
  surveyId: string;
  /** For the CSV file name. */
  surveyCode?: string;
  /** Called when the owner flips visibility so the parent can refresh. */
  onVisibilityChange?: (visibility: GroupVisibility) => void;
}

const POLL_MS = 6000;

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function kindLabel(kind: RoundKind) {
  return kind === "probe" ? "Probe · personal follow-ups" : "Poll · same ask for everyone";
}

/** `apiFetch` throws "API 400: {json}"; show the server's sentence, not the envelope. */
function apiErrorMessage(err: unknown, fallback: string) {
  if (!(err instanceof Error)) return fallback;
  const m = err.message.match(/^API \d+: (.*)$/s);
  if (!m) return err.message || fallback;
  try {
    const parsed = JSON.parse(m[1]) as { error?: string };
    return parsed.error || fallback;
  } catch {
    return fallback;
  }
}

function connectionDot(state: AgentConnection["state"]) {
  if (state === "ready") return "bg-success";
  if (state === "authenticating") return "bg-warning";
  if (state === "failed") return "bg-error";
  return "bg-neutral-6";
}

function connectionStatus(c: AgentConnection) {
  switch (c.state) {
    case "ready":
      return `${c.tools.length} tool${c.tools.length === 1 ? "" : "s"}`;
    case "authenticating":
      return "Needs your sign-in";
    case "failed":
      return c.error ? `Couldn't connect · ${c.error}` : "Couldn't connect";
    default:
      return "Connecting…";
  }
}

function ConnectionRow({ connection, busy, onRemove }: { connection: AgentConnection; busy: boolean; onRemove: () => void }) {
  return (
    <li className="flex items-center gap-s rounded-s bg-muted px-s py-xs" data-testid="connection" data-state={connection.state}>
      <span className={`w-2 h-2 rounded-full shrink-0 ${connectionDot(connection.state)}`} aria-hidden />
      <div className="flex-1 min-w-0">
        <p className="text-s text-foreground truncate">{connection.name}</p>
        <p className="text-xs text-muted-foreground truncate">{connectionStatus(connection)}</p>
      </div>
      {connection.state === "authenticating" && connection.authUrl && (
        <Button type="button" variant="secondary" size="sm" onClick={() => window.location.assign(connection.authUrl!)}>
          <ExternalLink aria-hidden />
          Sign in
        </Button>
      )}
      <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${connection.name}`} onClick={onRemove} disabled={busy}>
        <Trash2 aria-hidden />
      </Button>
    </li>
  );
}

function RoundCard({
  round,
  busy,
  onApprove,
  onReject,
}: {
  round: GroupRound;
  busy: boolean;
  onApprove?: () => void;
  onReject?: () => void;
}) {
  const proposed = round.status === "proposed";
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={transitionLarge}
      className={`rounded-m p-m flex flex-col gap-s ${proposed ? "bg-card shadow-edge-accent" : "bg-card"}`}
      data-testid={`round-${round.number}`}
      data-status={round.status}
    >
      <div className="flex items-center justify-between gap-s">
        <div className="min-w-0">
          <p className="text-s font-medium text-foreground">
            Round {round.number}
            <span className="text-muted-foreground font-regular"> · {kindLabel(round.kind)}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {round.status === "proposed"
              ? "Waiting for your approval"
              : round.status === "sent"
              ? `Sent ${formatWhen(round.sent_at)}`
              : round.status}
          </p>
        </div>
        {proposed && (
          <span className="shrink-0 inline-flex items-center rounded-full bg-badge text-badge-foreground px-s py-xxs font-brand text-xxs font-medium tracking-xl uppercase">
            New
          </span>
        )}
      </div>

      {round.rationale && <p className="text-s text-neutral-8">{round.rationale}</p>}

      <ul className="flex flex-col gap-xs">
        {round.asks.map((ask) => (
          <li key={ask.id} className="rounded-s bg-muted px-s py-xs">
            <p className="text-s text-foreground">{ask.text}</p>
            <p className="text-xs text-muted-foreground mt-xxs">
              {ask.targetName ? `For ${ask.targetName}` : "For everyone"}
              {ask.hint ? ` · ${ask.hint}` : ""}
            </p>
          </li>
        ))}
      </ul>

      {proposed && (
        <div className="flex gap-s pt-xxs">
          <Button type="button" variant="secondary" className="flex-1" onClick={onReject} disabled={busy}>
            <X aria-hidden />
            Not now
          </Button>
          <Button type="button" className="flex-1" onClick={onApprove} disabled={busy} data-testid="round-approve">
            <Send aria-hidden />
            Send round
          </Button>
        </div>
      )}
    </motion.div>
  );
}

/**
 * The owner's window into the group agent: the report it keeps for the
 * group, the rounds it has proposed, and the open-group switch.
 */
export default function AgentPanel({ apiKey, surveyId, surveyCode, onVisibilityChange }: AgentPanelProps) {
  const [snap, setSnap] = useState<AgentSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [digesting, setDigesting] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [acting, setActing] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  // Exports
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Back from an MCP provider's sign-in page: the agent redirects to this tab
  // with ?connection=connected|failed.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("connection");
    if (!outcome) return;
    if (outcome === "connected") toast.success("Destination connected. The agent can export there now.");
    else toast.error(params.get("reason") ? `Couldn't connect: ${params.get("reason")}` : "Couldn't connect the destination.");
    trackEvent("export_destination_oauth_returned", { surveyId, outcome });
    params.delete("connection");
    params.delete("reason");
    const qs = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, [surveyId]);

  const load = useCallback(async () => {
    try {
      const s = await fetchAgent(apiKey, surveyId);
      setSnap(s);
    } catch {
      // keep whatever we had
    } finally {
      setLoading(false);
    }
  }, [apiKey, surveyId]);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const handleDigest = async () => {
    setDigesting(true);
    trackEvent("agent_digest_clicked", { surveyId });
    try {
      const r = await runAgentDigest(apiKey, surveyId);
      if (!r.ok) toast.error(r.error ?? "The agent couldn't update the report.");
      else if (r.answersRead === 0) toast("No answers yet — the report appears once people respond.");
      else toast.success("Report updated.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The agent couldn't update the report.");
    } finally {
      setDigesting(false);
    }
  };

  const handlePropose = async (kind?: RoundKind) => {
    setProposing(true);
    trackEvent("agent_propose_clicked", { surveyId, kind: kind ?? "auto" });
    try {
      await proposeRound(apiKey, surveyId, kind ? { kind } : {});
      toast.success("The agent proposed a round. Review it below.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "The agent couldn't plan a round.");
    } finally {
      setProposing(false);
    }
  };

  const handleApprove = async (round: GroupRound) => {
    setActing(true);
    try {
      const r = await approveRound(apiKey, surveyId, round.id);
      toast.success(r.notified > 0 ? `Round ${round.number} sent to ${r.notified} ${r.notified === 1 ? "person" : "people"}.` : `Round ${round.number} is open.`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send the round.");
    } finally {
      setActing(false);
    }
  };

  const handleReject = async (round: GroupRound) => {
    setActing(true);
    try {
      await rejectRound(apiKey, surveyId, round.id);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't dismiss the round.");
    } finally {
      setActing(false);
    }
  };

  const handleVisibility = async (open: boolean) => {
    const visibility: GroupVisibility = open ? "open" : "private";
    setSnap((prev) => (prev ? { ...prev, visibility } : prev));
    try {
      await updateGroupSettings(apiKey, surveyId, { visibility });
      onVisibilityChange?.(visibility);
      trackEvent("group_visibility_toggled", { surveyId, visibility });
    } catch {
      toast.error("Couldn't change the group's visibility.");
      await load();
    }
  };

  const handleAddConnection = async () => {
    const name = newName.trim();
    const url = newUrl.trim();
    if (!name || !url) return;
    setConnecting(true);
    trackEvent("export_destination_add_clicked", { surveyId });
    try {
      const r = await addConnection(apiKey, surveyId, { name, url });
      if (r.authUrl) {
        // The provider sends the owner back to this tab when they're done.
        window.location.assign(r.authUrl);
        return;
      }
      toast.success(`${name} connected.`);
      setNewName("");
      setNewUrl("");
      setAdding(false);
      await load();
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't connect to that server."));
    } finally {
      setConnecting(false);
    }
  };

  const handleRemoveConnection = async (c: AgentConnection) => {
    setActing(true);
    try {
      await removeConnection(apiKey, surveyId, c.id);
      await load();
    } catch {
      toast.error("Couldn't remove it.");
    } finally {
      setActing(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    trackEvent("export_now_clicked", { surveyId });
    try {
      const r = await runAgentExport(apiKey, surveyId);
      if (r.ok) toast.success(r.summary ?? "Exported.");
      else toast.error(r.error ?? r.summary ?? "The export didn't go through.");
      await load();
    } catch (err) {
      toast.error(apiErrorMessage(err, "The export didn't go through."));
    } finally {
      setExporting(false);
    }
  };

  const handleAutoExport = async (enabled: boolean) => {
    setSnap((prev) => (prev ? { ...prev, state: { ...prev.state, autoExport: enabled } } : prev));
    try {
      await updateAgentSettings(apiKey, surveyId, { autoExport: enabled });
      trackEvent("export_auto_toggled", { surveyId, enabled });
    } catch {
      toast.error("Couldn't change that.");
      await load();
    }
  };

  const handleCsv = async () => {
    setDownloading(true);
    try {
      await downloadAnswersCsv(apiKey, surveyId, `parlo-${surveyCode ?? "answers"}-answers.csv`);
      trackEvent("export_csv_clicked", { surveyId });
    } catch {
      toast.error("Couldn't build the CSV.");
    } finally {
      setDownloading(false);
    }
  };

  if (loading && !snap) {
    return (
      <div className="flex justify-center py-xxl">
        <LoaderCircle size={24} className="animate-spin text-color-1" aria-hidden />
      </div>
    );
  }
  if (!snap) {
    return <p className="text-s text-muted-foreground text-center py-xxl">Couldn't reach the agent.</p>;
  }

  const proposed = snap.rounds.filter((r) => r.status === "proposed");
  const sent = snap.rounds.filter((r) => r.status === "sent").sort((a, b) => b.number - a.number);
  const vis = visibilityCopy(snap.visibility);
  const answersOnFile = snap.files.filter((f) => f.path.startsWith("/answers/")).length;
  const connections = snap.connections ?? [];
  const readyConnections = connections.filter((c) => c.state === "ready").length;

  return (
    <div className="flex flex-col gap-m" data-testid="agent-panel">
      {/* Status */}
      <div className="rounded-m bg-card p-m flex items-center gap-s">
        <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-color-1-transparent text-color-1">
          <Bot size={20} aria-hidden />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-s font-medium text-foreground">Your agent</p>
          <p className="text-xs text-muted-foreground truncate">
            {answersOnFile} answer{answersOnFile === 1 ? "" : "s"} on file · report {formatWhen(snap.reportUpdatedAt)}
            {snap.state.lastError ? " · last run failed" : ""}
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={handleDigest} disabled={digesting} aria-label="Update the report">
          {digesting ? <LoaderCircle className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
          {digesting ? "Thinking" : "Update"}
        </Button>
      </div>

      {/* Proposed rounds */}
      <AnimatePresence initial={false}>
        {proposed.map((round) => (
          <RoundCard key={round.id} round={round} busy={acting} onApprove={() => handleApprove(round)} onReject={() => handleReject(round)} />
        ))}
      </AnimatePresence>

      {proposed.length === 0 && (
        <div className="rounded-m bg-card p-m flex flex-col gap-s">
          <div className="flex items-center gap-s">
            <Sparkles size={16} className="text-color-1 shrink-0" aria-hidden />
            <p className="text-s font-medium text-foreground">Next round</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Ask the agent to plan the next round. You approve before anything goes out.
          </p>
          <div className="flex gap-s">
            <Button type="button" variant="secondary" size="sm" className="flex-1" onClick={() => handlePropose("poll")} disabled={proposing || answersOnFile === 0}>
              Poll everyone
            </Button>
            <Button type="button" variant="secondary" size="sm" className="flex-1" onClick={() => handlePropose("probe")} disabled={proposing || answersOnFile === 0}>
              Follow up 1:1
            </Button>
            <Button type="button" size="sm" className="flex-1" onClick={() => handlePropose()} disabled={proposing || answersOnFile === 0} data-testid="agent-propose">
              {proposing ? <LoaderCircle className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
              {proposing ? "Planning" : "Let it pick"}
            </Button>
          </div>
          {answersOnFile === 0 && <p className="text-xxs text-muted-foreground">Available once someone has answered.</p>}
        </div>
      )}

      {/* Report */}
      <div className="rounded-m bg-card p-m flex flex-col gap-s" data-testid="agent-report">
        <div className="flex items-center gap-s">
          <FileText size={16} className="text-muted-foreground shrink-0" aria-hidden />
          <p className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">The report members see</p>
        </div>
        {snap.report ? (
          <Markdown source={snap.report} />
        ) : (
          <p className="text-s text-muted-foreground">
            Nothing yet. A few minutes after the first answers land, the agent writes the first report and keeps it current as more arrive.
          </p>
        )}
      </div>

      {/* Visibility */}
      <div className="flex items-center gap-s rounded-m bg-card p-m">
        <div className="flex-1 flex flex-col gap-xxs">
          <Label htmlFor="open-group">{vis.label === "Open group" ? "Open group" : "Open group"}</Label>
          <p className="text-xs text-muted-foreground">{vis.settingDescription}</p>
        </div>
        <Switch id="open-group" checked={snap.visibility === "open"} onCheckedChange={handleVisibility} data-testid="open-group-switch" />
      </div>

      {/* Exports */}
      <div className="rounded-m bg-card p-m flex flex-col gap-s" data-testid="agent-exports">
        <div className="flex items-center gap-s">
          <Upload size={16} className="text-muted-foreground shrink-0" aria-hidden />
          <p className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">Exports</p>
        </div>
        <p className="text-xs text-muted-foreground">
          Connect an MCP server and the agent sends the report and the answers table there with the server's own tools. Zapier, Pipedream and Composio offer one for Google Sheets, Notion and most other apps.
        </p>

        {connections.length > 0 && (
          <ul className="flex flex-col gap-xs">
            {connections.map((c) => (
              <ConnectionRow key={c.id} connection={c} busy={acting} onRemove={() => handleRemoveConnection(c)} />
            ))}
          </ul>
        )}

        {adding ? (
          <div className="flex flex-col gap-xs" data-testid="connection-form">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name, e.g. Google Sheets"
              aria-label="Destination name"
              maxLength={40}
              autoFocus
            />
            <Input
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://… the MCP server URL"
              aria-label="MCP server URL"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <div className="flex gap-s">
              <Button type="button" variant="secondary" className="flex-1" onClick={() => setAdding(false)} disabled={connecting}>
                Cancel
              </Button>
              <Button
                type="button"
                className="flex-1"
                onClick={handleAddConnection}
                disabled={connecting || !newName.trim() || !newUrl.trim()}
                data-testid="connection-connect"
              >
                {connecting ? <LoaderCircle className="animate-spin" aria-hidden /> : <Plug aria-hidden />}
                {connecting ? "Connecting" : "Connect"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-s">
            <Button type="button" variant="secondary" size="sm" className="flex-1" onClick={() => setAdding(true)} data-testid="connection-add">
              <Plus aria-hidden />
              Add destination
            </Button>
            <Button type="button" size="sm" className="flex-1" onClick={handleExport} disabled={exporting || readyConnections === 0} data-testid="export-now">
              {exporting ? <LoaderCircle className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
              {exporting ? "Exporting" : "Export now"}
            </Button>
          </div>
        )}

        {(snap.state.lastExportAt || snap.state.lastExportError) && (
          <p className={`text-xs ${snap.state.lastExportError ? "text-error" : "text-muted-foreground"}`} data-testid="export-status">
            {snap.state.lastExportError
              ? `Last export failed: ${snap.state.lastExportError.slice(0, 200)}`
              : `Last export ${formatWhen(snap.state.lastExportAt)}${snap.state.lastExportSummary ? ` · ${snap.state.lastExportSummary.slice(0, 200)}` : ""}`}
          </p>
        )}

        <div className="flex items-center gap-s pt-xxs">
          <div className="flex-1 flex flex-col gap-xxs">
            <Label htmlFor="auto-export">Export after every report</Label>
            <p className="text-xs text-muted-foreground">Each time the agent updates the report it pushes it to every connected destination.</p>
          </div>
          <Switch
            id="auto-export"
            checked={!!snap.state.autoExport}
            onCheckedChange={handleAutoExport}
            disabled={connections.length === 0}
            data-testid="auto-export-switch"
          />
        </div>

        <Button type="button" variant="ghost" size="sm" className="self-start -ml-xs" onClick={handleCsv} disabled={downloading || answersOnFile === 0}>
          <Download aria-hidden />
          Download answers as CSV
        </Button>
      </div>

      {/* Sent rounds */}
      {sent.length > 0 && (
        <div className="flex flex-col gap-s">
          <p className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground px-xxs">Rounds</p>
          {sent.map((round) => (
            <RoundCard key={round.id} round={round} busy={acting} />
          ))}
        </div>
      )}

      {/* Agent notes */}
      <div className="rounded-m bg-card p-m flex flex-col gap-s">
        <button
          type="button"
          className="flex items-center justify-between text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring rounded-xs"
          onClick={() => setShowMemory((v) => !v)}
          aria-expanded={showMemory}
        >
          <span className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">The agent's notes</span>
          <span className="text-xs text-muted-foreground">{showMemory ? "Hide" : "Show"}</span>
        </button>
        <AnimatePresence initial={false}>
          {showMemory && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={transitionSmall} className="overflow-hidden">
              {snap.memory ? <Markdown source={snap.memory} /> : <p className="text-s text-muted-foreground">No notes yet.</p>}
              <p className="text-xxs text-muted-foreground mt-s">
                {snap.files.length} files · {snap.state.provider ? `${snap.state.provider} · ${snap.state.model}` : "no model run yet"}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {snap.state.lastError && (
        <p className="text-xs text-error px-xxs">
          <Check size={12} className="inline mr-xxs" aria-hidden />
          Last run: {snap.state.lastError}
        </p>
      )}
    </div>
  );
}
