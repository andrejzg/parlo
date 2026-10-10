import { motion } from "framer-motion";
import { Camera, Mic, Users, Video } from "lucide-react";
import { Survey } from "@/types/survey";
import { Button } from "@/components/ui/button";
import { stagger, fadeUp } from "@/lib/animations";
import { getMediaMix } from "@/lib/mediaMix";
import VoiceNotePill from "@/components/VoiceNotePill";
import { visibilityCopy } from "@/lib/visibility";

interface WelcomeScreenProps {
  survey: Survey;
  onStart: () => void;
  /** Members can skip straight to the group's report. */
  onSeeReport?: () => void;
}

export default function WelcomeScreen({ survey, onStart, onSeeReport }: WelcomeScreenProps) {
  const mix = getMediaMix(survey.questions);
  const vis = visibilityCopy(survey.visibility);
  const round = survey.round ?? null;
  const isProbe = round?.kind === "probe" && survey.member;
  const firstName = survey.member?.displayName?.split(" ")[0];
  const hasPending = survey.questions.length > 0;
  return (
    <motion.div
      className="flex flex-col items-center justify-between h-full px-l pt-l pb-safe sm:py-xxl text-center"
      variants={stagger}
      initial="initial"
      animate="animate"
    >
      {/* Brand mark */}
      <motion.div variants={fadeUp}>
        <span className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">Parlo</span>
      </motion.div>

      {/* Main content */}
      <div className="flex flex-col items-center gap-l max-w-sm mx-auto">
        {(round && round.number > 1) || firstName ? (
          <motion.div variants={fadeUp} className="flex items-center gap-s">
            {round && round.number > 1 && (
              <span className="inline-flex items-center rounded-full bg-muted px-s py-xxs font-brand text-xxs font-medium tracking-xl uppercase text-neutral-8" data-testid="welcome-round">
                Round {round.number}
              </span>
            )}
            {firstName && <span className="text-xs text-muted-foreground">Welcome back, {firstName}</span>}
          </motion.div>
        ) : null}

        <motion.h1 variants={fadeUp} className="font-brand text-l sm:text-xl font-heavy text-foreground">
          {survey.title}
        </motion.h1>

        <motion.p variants={fadeUp} className="text-m text-neutral-8">
          {isProbe
            ? "The agent has a follow-up question just for you, based on what you said last time."
            : hasPending
            ? survey.description
            : "You've answered everything in this round."}
        </motion.p>

        {/* The creator's voice hello — a real person asking beats any copy. */}
        {survey.intro && (
          <motion.div variants={fadeUp} className="w-full flex flex-col gap-xs text-left" data-testid="welcome-intro">
            <span className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground px-xxs">
              A hello from the person asking
            </span>
            <VoiceNotePill url={survey.intro.audioUrl} durationMs={survey.intro.durationMs} />
          </motion.div>
        )}

        <motion.div
          variants={fadeUp}
          className="flex flex-wrap items-center justify-center gap-x-s gap-y-xxs mt-xs text-s text-muted-foreground"
        >
          <span className="flex items-center gap-xs whitespace-nowrap">
            {mix.isVoiceOnly || mix.hasVoice ? (
              <Mic size={14} aria-hidden />
            ) : mix.hasVideo ? (
              <Video size={14} aria-hidden />
            ) : (
              <Camera size={14} aria-hidden />
            )}
            {mix.label}
          </span>
          <span className="text-neutral-6">&middot;</span>
          <span className="whitespace-nowrap">{survey.questions.length} question{survey.questions.length !== 1 ? "s" : ""}</span>
          <span className="text-neutral-6">&middot;</span>
          <span className="whitespace-nowrap">{mix.timeEstimate}</span>
          {typeof survey.memberCount === "number" && survey.memberCount > 1 && (
            <>
              <span className="text-neutral-6">&middot;</span>
              <span className="flex items-center gap-xs whitespace-nowrap">
                <Users size={14} aria-hidden />
                {survey.memberCount} in the group
              </span>
            </>
          )}
        </motion.div>

        <motion.p variants={fadeUp} className="text-xs text-muted-foreground" data-testid="welcome-visibility">
          {vis.short}
        </motion.p>
      </div>

      {/* CTA */}
      <motion.div variants={fadeUp} className="w-full max-w-xs flex flex-col items-center gap-m">
        {hasPending ? (
          <Button size="lg" className="w-full" onClick={onStart}>
            {survey.ctaLabel}
          </Button>
        ) : onSeeReport ? (
          <Button size="lg" className="w-full" onClick={onSeeReport}>
            See what the group said
          </Button>
        ) : (
          <Button size="lg" className="w-full" onClick={onStart} disabled>
            Nothing to answer yet
          </Button>
        )}
        {hasPending && onSeeReport && (
          <Button variant="link" size="sm" onClick={onSeeReport}>
            See the group's report first
          </Button>
        )}
        <p className="text-xs text-muted-foreground">{mix.securityFootnote}</p>
      </motion.div>
    </motion.div>
  );
}
