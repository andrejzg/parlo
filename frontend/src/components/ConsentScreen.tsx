import { useEffect } from "react";
import { motion } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import PublishConsentBlock from "@/components/participant/PublishConsentBlock";
import type { PublishConsent } from "@/api/client";
import { stagger, fadeUp } from "@/lib/animations";
import { trackEvent } from "@/lib/posthog";

interface ConsentScreenProps {
  description: string;
  buttonLabel: string;
  onConsent: () => void;
  isLoading?: boolean;
  onBack?: () => void;
  /**
   * A study only: ask, under the description, whether this person's words or
   * voice may be used in public material. Leave it out and nothing renders.
   */
  publish?: { value: PublishConsent; onChange: (value: PublishConsent) => void };
}

export default function ConsentScreen({ description, buttonLabel, onConsent, isLoading, onBack, publish }: ConsentScreenProps) {
  useEffect(() => {
    trackEvent("consent_screen_viewed");
  }, []);

  return (
    <motion.div
      className="flex flex-col items-center h-full px-l pt-l pb-safe sm:py-xxl text-center"
      variants={stagger}
      initial="initial"
      animate="animate"
    >
      {/* Top row: back button + wordmark */}
      <motion.div variants={fadeUp} className="shrink-0 w-full flex items-center justify-between">
        {onBack ? (
          <Button type="button" variant="ghost" size="icon" onClick={onBack} aria-label="Back" className="-ml-xs">
            <ChevronLeft className="!size-6" aria-hidden />
          </Button>
        ) : (
          <div className="w-11" />
        )}
        <span className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">Parlo</span>
        <div className="w-11" />
      </motion.div>

      {/* Main content: centred while it fits (the auto margins), scrolls when
          it does not, so the CTA below is always reachable. `min-h-0` lets the
          flex item shrink; without it nothing would scroll. */}
      <div className="flex-1 min-h-0 w-full overflow-y-auto flex flex-col py-m">
        <div className="flex flex-col items-center gap-l w-full max-w-sm m-auto">
          <motion.h1 variants={fadeUp} className="font-brand text-l sm:text-xl font-heavy text-foreground">
            Before you start
          </motion.h1>

          <motion.p variants={fadeUp} className="text-m text-neutral-8">
            {description}
          </motion.p>

          {publish && (
            <motion.div variants={fadeUp} className="w-full">
              <PublishConsentBlock value={publish.value} onChange={publish.onChange} />
            </motion.div>
          )}

          <motion.p variants={fadeUp} className="text-s text-muted-foreground">
            By continuing, you agree to our{" "}
            <a href="https://parlo.me/terms" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">Terms of Service</a> and{" "}
            <a href="https://parlo.me/privacy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">Privacy Policy</a>.
          </motion.p>
        </div>
      </div>

      {/* CTA */}
      <motion.div variants={fadeUp} className="shrink-0 w-full max-w-xs flex flex-col items-center gap-m">
        <Button size="lg" className="w-full" onClick={onConsent} disabled={isLoading}>
          {isLoading ? "Setting up..." : buttonLabel}
        </Button>
      </motion.div>
    </motion.div>
  );
}
