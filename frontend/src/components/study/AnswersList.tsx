import { useCallback, useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { fetchStudyAnswers, type StudyAnswer } from "@/api/study";
import { Button } from "@/components/ui/button";
import VoiceNotePill from "@/components/VoiceNotePill";

function when(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function AnswerCard({ answer }: { answer: StudyAnswer }) {
  return (
    <li className="rounded-m bg-card p-m flex flex-col gap-s" data-testid="study-answer">
      <div className="flex items-center justify-between gap-s">
        <p className="min-w-0 truncate text-s font-medium text-foreground">{answer.who}</p>
        <p className="shrink-0 font-data text-xs tabular-nums text-muted-foreground">
          {answer.roundNumber === 0 ? "Interview" : `Round ${answer.roundNumber}`} · {when(answer.submittedAt)}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">{answer.questionText}</p>
      {answer.audioUrl && <VoiceNotePill url={answer.audioUrl} durationMs={answer.durationMs} className="bg-muted" />}
      {answer.videoUrl && <video src={answer.videoUrl} controls playsInline className="w-full rounded-s" />}
      {answer.imageUrl && <img src={answer.imageUrl} alt="" className="w-full rounded-s" />}
      {answer.transcription ? (
        <p className="text-s text-neutral-8 whitespace-pre-line">{answer.transcription}</p>
      ) : answer.transcriptionStatus === "pending" ? (
        <p className="text-xs text-muted-foreground">Transcribing…</p>
      ) : null}
    </li>
  );
}

/** Raw answers as the team hears them. The client gets labels in place of names. */
export default function AnswersList({ apiKey, surveyId, isClient, sponsor }: { apiKey: string; surveyId: string; isClient: boolean; sponsor: string | null }) {
  const [answers, setAnswers] = useState<StudyAnswer[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(
    async (offset: number) => {
      setLoading(true);
      try {
        const page = await fetchStudyAnswers(apiKey, surveyId, offset);
        setAnswers((prev) => (offset === 0 ? page.answers : [...prev, ...page.answers]));
        setTotal(page.total);
        setHasMore(page.hasMore);
        setFailed(false);
      } catch {
        setFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [apiKey, surveyId]
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  return (
    <div className="flex flex-col gap-s" data-testid="study-answers">
      {isClient && (
        <p className="rounded-m bg-card p-m text-xs text-muted-foreground">
          You hear what participants said after they were told that {sponsor ?? "your company"} hears their answers. Names are replaced by labels so people speak freely.
        </p>
      )}
      {failed && <p className="text-s text-muted-foreground text-center py-l">Couldn't load the answers.</p>}
      {!loading && !failed && answers.length === 0 && (
        <div className="rounded-m bg-card p-m">
          <p className="text-s text-neutral-8">No answers to hear yet.</p>
          <p className="text-s text-muted-foreground">They show here as soon as someone answers.</p>
        </div>
      )}
      <ul className="flex flex-col gap-xs">
        {answers.map((a) => (
          <AnswerCard key={a.id} answer={a} />
        ))}
      </ul>
      {loading && (
        <div className="flex justify-center py-m">
          <LoaderCircle size={24} className="animate-spin text-color-1" aria-hidden />
        </div>
      )}
      {hasMore && !loading && (
        <Button type="button" variant="secondary" className="self-center" onClick={() => load(answers.length)}>
          Load more ({total - answers.length} left)
        </Button>
      )}
    </div>
  );
}
