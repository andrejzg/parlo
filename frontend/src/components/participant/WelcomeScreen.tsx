import { motion } from "framer-motion";
import { Camera, Mic, Video } from "lucide-react";
import { Survey } from "@/types/survey";
import { Button } from "@/components/ui/button";
import { stagger, fadeUp } from "@/lib/animations";
import { getMediaMix } from "@/lib/mediaMix";
import VoiceNotePill from "@/components/VoiceNotePill";

interface WelcomeScreenProps {
  survey: Survey;
  onStart: () => void;
}

export default function WelcomeScreen({ survey, onStart }: WelcomeScreenProps) {
  const mix = getMediaMix(survey.questions);
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
        <motion.h1 variants={fadeUp} className="font-brand text-l sm:text-xl font-heavy text-foreground">
          {survey.title}
        </motion.h1>

        <motion.p variants={fadeUp} className="text-m text-neutral-8">
          {survey.description}
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
        </motion.div>
      </div>

      {/* CTA */}
      <motion.div variants={fadeUp} className="w-full max-w-xs flex flex-col items-center gap-m">
        <Button size="lg" className="w-full" onClick={onStart}>
          {survey.ctaLabel}
        </Button>
        <p className="text-xs text-muted-foreground">{mix.securityFootnote}</p>
      </motion.div>
    </motion.div>
  );
}
