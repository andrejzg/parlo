import { motion } from "framer-motion";
import { Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { stagger, fadeUp } from "@/lib/animations";

interface CreateLandingProps {
  onCreateAgent: () => void;
}

export default function CreateLanding({ onCreateAgent }: CreateLandingProps) {
  return (
    <div className="relative h-full w-full flex flex-col overflow-hidden bg-background">
      {/* Hero — the 36% / 30svh proportions are structural layout, not theme values */}
      <div className="relative w-full flex-shrink-0 max-h-[30svh]" style={{ height: "36%" }}>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-24 h-24 rounded-full flex items-center justify-center bg-color-1-transparent text-color-1">
            <Mic size={36} aria-hidden />
          </div>
        </div>
      </div>

      {/* Headline + CTA */}
      <motion.div
        className="flex flex-col px-l pt-xs pb-xl flex-1"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        <motion.h1
          variants={fadeUp}
          className="font-brand text-xl sm:text-xxl font-heavy text-foreground mb-xs sm:mb-m"
        >
          Group chats, run by an agent.
        </motion.h1>

        <motion.p variants={fadeUp} className="text-m text-neutral-8 mb-auto">
          Your agent gathers everyone's answers, follows up, and reports back.
        </motion.p>

        <motion.div variants={fadeUp} className="mt-m sm:mt-xl flex flex-col gap-s w-full">
          <Button size="lg" className="w-full" onClick={onCreateAgent}>
            Create a parlo
          </Button>
          <p className="text-xs text-muted-foreground text-center">Free to start · No account required</p>
          <p className="text-xxs text-muted-foreground text-center">
            AI agent?{" "}
            <a href="/llms.txt" className="underline underline-offset-2">
              Read parlo.me/llms.txt
            </a>{" "}
            instead of tapping.
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}
