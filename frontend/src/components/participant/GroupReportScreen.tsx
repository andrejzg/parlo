import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Lock, Mic, RefreshCw, Users } from "lucide-react";
import type { Survey } from "@/types/survey";
import { Button } from "@/components/ui/button";
import VoiceNotePill from "@/components/VoiceNotePill";
import { Markdown } from "@/lib/markdown";
import { visibilityCopy } from "@/lib/visibility";
import { buildShareUrl } from "@/lib/slug";
import { fetchGroupFeed, type GroupFeedItem } from "@/api/client";
import { trackEvent } from "@/lib/posthog";
import { fadeUp, stagger } from "@/lib/animations";

interface GroupReportScreenProps {
  survey: Survey;
  code: string;
  token: string | null;
  /** Number of asks still pending for this member. */
  pendingCount: number;
  onAnswer: () => void;
  onRefresh?: () => void;
}

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + " · " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/**
 * What a member sees once they're in: the agent's report (unlocked by
 * answering), the open-group feed when the group is open, and the way into
 * the next round.
 */
export default function GroupReportScreen({ survey, code, token, pendingCount, onAnswer, onRefresh }: GroupReportScreenProps) {
  const report = survey.report ?? { available: false, unlocked: false, markdown: null, updatedAt: null };
  const vis = visibilityCopy(survey.visibility);
  const isOpen = survey.visibility === "open";
  const [feed, setFeed] = useState<GroupFeedItem[] | null>(null);
  const [feedError, setFeedError] = useState(false);

  useEffect(() => {
    trackEvent("group_report_viewed", { surveyCode: code, unlocked: report.unlocked, available: report.available });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isOpen || !token || !report.unlocked) return;
    let cancelled = false;
    fetchGroupFeed(code, token)
      .then((r) => {
        if (!cancelled) setFeed(r.items);
      })
      .catch(() => {
        if (!cancelled) setFeedError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, token, code, report.unlocked]);

  const shareUrl = buildShareUrl(survey.title, code);
  const whatsappShareUrl = `https://wa.me/?text=${encodeURIComponent(`Join this parlo: ${shareUrl}`)}`;
  const greeting = survey.member?.displayName ? `Hey, ${survey.member.displayName.split(" ")[0]}` : "You're in";

  return (
    <motion.div
      className="flex flex-col h-full px-l pt-l pb-safe sm:py-xxl bg-background"
      variants={stagger}
      initial="initial"
      animate="animate"
      data-testid="group-report"
    >
      {/* Header */}
      <motion.div variants={fadeUp} className="shrink-0 flex items-center justify-between">
        <span className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">Parlo</span>
        {onRefresh && (
          <Button type="button" variant="ghost" size="icon" aria-label="Refresh" onClick={onRefresh} className="-mr-xs">
            <RefreshCw aria-hidden />
          </Button>
        )}
      </motion.div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-l py-l">
        <motion.div variants={fadeUp} className="flex flex-col gap-xs">
          <p className="text-xs text-muted-foreground">{greeting}</p>
          <h1 className="font-brand text-l sm:text-xl font-heavy text-foreground">{survey.title}</h1>
          <div className="flex flex-wrap items-center gap-x-s gap-y-xxs text-s text-muted-foreground">
            {survey.round && (
              <span className="inline-flex items-center rounded-full bg-muted px-s py-xxs font-brand text-xxs font-medium tracking-xl uppercase text-neutral-8">
                Round {survey.round.number}
              </span>
            )}
            <span className="flex items-center gap-xs whitespace-nowrap">
              <Users size={14} aria-hidden />
              {survey.memberCount ?? 0} member{(survey.memberCount ?? 0) === 1 ? "" : "s"}
            </span>
            <span className="text-neutral-6">&middot;</span>
            <span>{vis.label}</span>
          </div>
        </motion.div>

        {/* The report */}
        <motion.section variants={fadeUp} className="rounded-m bg-card p-m flex flex-col gap-s" data-testid="group-report-card">
          <div className="flex items-center justify-between gap-s">
            <p className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">The agent's report</p>
            {report.updatedAt && <span className="font-data text-xxs tabular-nums text-muted-foreground">{formatWhen(report.updatedAt)}</span>}
          </div>

          {report.unlocked && report.markdown ? (
            <Markdown source={report.markdown} />
          ) : report.unlocked ? (
            <p className="text-s text-muted-foreground">
              The agent is still listening. The report appears here once a few people have answered.
            </p>
          ) : (
            <div className="flex items-start gap-s">
              <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-muted text-muted-foreground">
                <Lock size={16} aria-hidden />
              </div>
              <p className="text-s text-neutral-8">
                {report.available
                  ? "Answer this round to unlock what the group said."
                  : "Answer to join the group. You'll get the agent's report as soon as it's ready."}
              </p>
            </div>
          )}
        </motion.section>

        {/* Open group: everyone's answers */}
        {isOpen && report.unlocked && (
          <motion.section variants={fadeUp} className="flex flex-col gap-s" data-testid="group-feed">
            <p className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground px-xxs">What people said</p>
            {feedError ? (
              <p className="text-s text-muted-foreground px-xxs">Couldn't load the group's answers right now.</p>
            ) : feed === null ? (
              <p className="text-s text-muted-foreground px-xxs">Loading…</p>
            ) : feed.length === 0 ? (
              <p className="text-s text-muted-foreground px-xxs">Nothing shared with the group yet. Answers given while the group was private stay private.</p>
            ) : (
              feed.map((item) => (
                <div key={item.id} className="rounded-m bg-card p-m flex flex-col gap-xs">
                  <div className="flex items-center gap-s">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-muted text-xs font-medium text-neutral-8">
                      {item.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-s font-medium text-foreground">{item.name}</span>
                      <span className="text-xs text-muted-foreground ml-xs">Round {item.roundNumber}</span>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">{item.questionText}</p>
                  {item.transcription && <p className="text-s text-neutral-8">{item.transcription}</p>}
                  {item.audioUrl && <VoiceNotePill url={item.audioUrl} durationMs={item.durationMs} className="bg-muted" />}
                  {item.imageUrl && (
                    <div className="rounded-s overflow-hidden">
                      <img src={item.imageUrl} alt={item.questionText} className="w-full h-auto block" loading="lazy" />
                    </div>
                  )}
                  {item.videoUrl && (
                    <div className="rounded-s overflow-hidden bg-background">
                      <video src={item.videoUrl} controls playsInline className="w-full h-auto block" />
                    </div>
                  )}
                </div>
              ))
            )}
          </motion.section>
        )}

        <motion.p variants={fadeUp} className="text-xs text-muted-foreground px-xxs">{vis.short}</motion.p>
      </div>

      {/* CTA */}
      <motion.div variants={fadeUp} className="shrink-0 flex flex-col gap-s">
        {pendingCount > 0 ? (
          <Button size="lg" className="w-full" onClick={onAnswer} data-testid="group-answer-cta">
            <Mic aria-hidden />
            {survey.round && survey.round.kind === "probe" ? "The agent has a question for you" : `Answer round ${survey.round?.number ?? 1}`}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground text-center">You're up to date. We'll let you know when the next round opens.</p>
        )}
        <Button variant="secondary" size="lg" className="w-full" asChild>
          <a href={whatsappShareUrl} target="_blank" rel="noopener noreferrer" onClick={() => trackEvent("participant_share_survey_clicked", { surveyCode: code, from: "report" })}>
            Invite someone
          </a>
        </Button>
      </motion.div>
    </motion.div>
  );
}
