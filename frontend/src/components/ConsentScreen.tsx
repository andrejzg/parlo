import { useEffect } from "react";
import { motion } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { stagger, fadeUp } from "@/lib/animations";
import { trackEvent } from "@/lib/posthog";

interface ConsentScreenProps {
  description: string;
  buttonLabel: string;
  onConsent: () => void;
  isLoading?: boolean;
  onBack?: () => void;
}

export default function ConsentScreen({ description, buttonLabel, onConsent, isLoading, onBack }: ConsentScreenProps) {
  useEffect(() => {
    trackEvent("consent_screen_viewed");
  }, []);

  return (
    <motion.div
      className="flex flex-col items-center justify-between h-full px-l pt-l pb-safe sm:py-xxl text-center"
      variants={stagger}
      initial="initial"
      animate="animate"
    >
      {/* Top row: back button + wordmark */}
      <motion.div variants={fadeUp} className="w-full flex items-center justify-between">
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

      {/* Main content */}
      <div className="flex flex-col items-center gap-l max-w-sm mx-auto">
        <motion.h1 variants={fadeUp} className="font-brand text-l sm:text-xl font-heavy text-foreground">
          Before you start
        </motion.h1>

        <motion.p variants={fadeUp} className="text-m text-neutral-8">
          {description}
        </motion.p>

        <motion.p variants={fadeUp} className="text-s text-muted-foreground">
          By continuing, you agree to our{" "}
          <a href="https://parlo.me/terms" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">Terms of Service</a> and{" "}
          <a href="https://parlo.me/privacy" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-foreground">Privacy Policy</a>.
        </motion.p>
      </div>

      {/* CTA */}
      <motion.div variants={fadeUp} className="w-full max-w-xs flex flex-col items-center gap-m">
        <Button size="lg" className="w-full" onClick={onConsent} disabled={isLoading}>
          {isLoading ? "Setting up..." : buttonLabel}
        </Button>
      </motion.div>
    </motion.div>
  );
}
