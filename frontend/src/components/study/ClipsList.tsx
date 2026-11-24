import { useEffect, useState } from "react";
import { Copy, Download, LoaderCircle } from "lucide-react";
import { fetchClips, formatMoney, type StudyClip } from "@/api/study";
import { Button } from "@/components/ui/button";
import VoiceNotePill from "@/components/VoiceNotePill";
import { copyText } from "@/components/creator/studyUi";
import { labelClass, PublishChip, VerdictChip } from "@/components/study/BriefBoard";
import { trackEvent } from "@/lib/posthog";

function ClipCard({ clip, currency, surveyId }: { clip: StudyClip; currency: string; surveyId: string }) {
  const words = clip.transcription?.trim() ?? "";
  // The recording leaves the study only with "voice" consent; with "quote" it is the words, unnamed.
  // `dl` makes the server answer with a download header; a cross-origin `download` attribute alone is ignored.
  const fileName = `${clip.who}-${clip.testimonial ? "testimonial" : `round-${clip.roundNumber}`}`;
  const downloadUrl = clip.audioUsable && clip.audioUrl ? `${clip.audioUrl}${clip.audioUrl.includes("?") ? "&" : "?"}dl=${encodeURIComponent(fileName)}` : null;
  const wordsOnly = !clip.audioUsable && clip.publishConsent !== "voice";
  const meta = { surveyId, clipId: clip.id, round: clip.roundNumber, testimonial: clip.testimonial };

  const copy = async () => {
    trackEvent("clip_copied", meta);
    await copyText(words);
  };

  return (
    <li className="rounded-m bg-card p-m flex flex-col gap-s" data-testid="clip" data-testimonial={clip.testimonial ? "true" : "false"}>
      <div className="flex items-center justify-between gap-s">
        <p className="min-w-0 truncate text-s font-medium text-foreground">
          {clip.who}
          {clip.segment && <span className="font-regular text-muted-foreground"> · {clip.segment}</span>}
        </p>
        <p className="shrink-0 font-data text-xs tabular-nums text-muted-foreground">{clip.roundNumber === 0 ? "Interview" : `Round ${clip.roundNumber}`}</p>
      </div>
      <div className="flex items-start justify-between gap-s">
        <p className="min-w-0 text-xs text-muted-foreground">{clip.questionText}</p>
        <div className="flex shrink-0 flex-col items-end gap-xxs empty:hidden">
          <PublishChip consent={clip.publishConsent} />
          <VerdictChip verdict={clip.verdict} note={clip.verdictNote} />
        </div>
      </div>
      {clip.audioUrl && <VoiceNotePill url={clip.audioUrl} durationMs={clip.durationMs} className="bg-muted" />}
      {words && <p className="text-s text-neutral-8 whitespace-pre-line">{words}</p>}
      {clip.incentivised && (
        <p className="rounded-s bg-warning-transparent px-s py-xs text-xs text-warning" data-testid="clip-incentivised">
          {clip.bonusCents > 0 ? `Recorded for a ${formatMoney(clip.bonusCents, currency)} bonus.` : "Recorded for a bonus."} Say so wherever it is published.
        </p>
      )}
      {(clip.notice || wordsOnly) && (
        <div className="flex flex-col gap-xxs">
          {clip.notice && <p className="text-xs text-muted-foreground">They were told: “{clip.notice}”</p>}
          {wordsOnly && <p className="text-xs text-muted-foreground">Words only: the recording stays inside the study.</p>}
        </div>
      )}
      <div className="flex flex-wrap gap-xs">
        <Button type="button" variant="secondary" size="sm" onClick={copy} disabled={!words} data-testid="clip-copy">
          <Copy aria-hidden />
          Copy quote
        </Button>
        {downloadUrl && (
          <Button asChild variant="secondary" size="sm">
            <a href={downloadUrl} download target="_blank" rel="noreferrer" onClick={() => trackEvent("clip_downloaded", meta)} data-testid="clip-download">
              <Download aria-hidden />
              Download
            </a>
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * What may be used in public, for the research team to clear before it goes
 * anywhere: the lines recorded as testimonials, then the answers whose
 * speaker allowed quoting on the consent screen. Names show here, so the
 * client never gets this tab.
 */
export default function ClipsList({ apiKey, surveyId }: { apiKey: string; surveyId: string }) {
  const [clips, setClips] = useState<StudyClip[] | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stale = false;
    setClips(null);
    setFailed(false);
    fetchClips(apiKey, surveyId)
      .then((r) => {
        if (stale) return;
        // A clip is a line or a recording: an answer with neither (a photo) has nothing to use.
        const usable = (r.clips ?? []).filter((c) => !!c.transcription?.trim() || !!c.audioUrl);
        setClips(usable);
        setCurrency(r.currency || "USD");
        trackEvent("clips_tab_opened", { surveyId, clips: usable.length });
      })
      .catch(() => {
        if (!stale) setFailed(true);
      });
    return () => {
      stale = true;
    };
  }, [apiKey, surveyId]);

  const groups = [
    { key: "testimonial", title: "Recorded for public use", clips: (clips ?? []).filter((c) => c.testimonial) },
    { key: "cleared", title: "Cleared by the participant", clips: (clips ?? []).filter((c) => !c.testimonial) },
  ].filter((g) => g.clips.length > 0);

  return (
    <div className="flex flex-col gap-m" data-testid="study-clips">
      {failed && <p className="text-s text-muted-foreground text-center py-l">Couldn't load the clips.</p>}
      {!failed && clips === null && (
        <div className="flex justify-center py-m">
          <LoaderCircle size={24} className="animate-spin text-color-1" aria-hidden />
        </div>
      )}
      {clips !== null && clips.length === 0 && (
        <div className="rounded-m bg-card p-m" data-testid="clips-empty">
          <p className="text-s text-neutral-8">Nothing is cleared for public use yet.</p>
          <p className="text-s text-muted-foreground">
            A participant can allow it on the consent screen, or you can ask the people who were positive for a testimonial from the Brief tab.
          </p>
        </div>
      )}
      {groups.map((group) => (
        <section key={group.key} className="flex flex-col gap-s" data-testid="clips-group" data-group={group.key}>
          <h2 className={`${labelClass} px-xxs`}>{group.title}</h2>
          <ul className="flex flex-col gap-xs">
            {group.clips.map((clip) => (
              <ClipCard key={clip.id} clip={clip} currency={currency} surveyId={surveyId} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
