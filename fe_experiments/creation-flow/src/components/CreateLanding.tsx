import { motion } from "framer-motion";
import voiceHero from "@/assets/voice-hero.jpg";

interface CreateLandingProps {
  onCreateAgent: () => void;
}

const stagger = {
  animate: { transition: { staggerChildren: 0.09, delayChildren: 0.1 } },
};

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as number[] },
  },
};

export default function CreateLanding({ onCreateAgent }: CreateLandingProps) {
  return (
    <div className="relative h-full w-full flex flex-col overflow-hidden bg-background">
      {/* Hero image — top half */}
      <div className="relative w-full flex-shrink-0" style={{ height: "44%" }}>
        <img
          src={voiceHero}
          alt="Voice agent visualization"
          width={640}
          height={640}
          className="w-full h-full object-cover object-center"
        />
        {/* Fade-out bottom edge so image blends into background */}
        <div
          className="absolute inset-x-0 bottom-0 h-28 pointer-events-none"
          style={{
            background:
              "linear-gradient(to bottom, transparent, hsl(var(--background)))",
          }}
        />
        {/* Top nav bar */}
        <div className="absolute top-0 inset-x-0 flex items-center justify-between px-5 pt-10 pb-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-primary rec-blink" />
            <span className="font-display text-sm font-semibold tracking-widest uppercase text-foreground/80">
              VoiceForm
            </span>
          </div>
          <button className="w-8 h-8 flex flex-col justify-center items-end gap-[5px] opacity-60">
            <span className="block w-5 h-[1.5px] bg-foreground rounded-full" />
            <span className="block w-3.5 h-[1.5px] bg-foreground rounded-full" />
          </button>
        </div>
      </div>

      {/* Bottom content — Partiful-style bold text + CTA */}
      <motion.div
        className="flex flex-col px-6 pt-2 pb-10 flex-1"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        {/* Social proof pill */}
        <motion.div variants={fadeUp} className="mb-5">
          <div
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium"
            style={{ background: "hsl(var(--secondary))" }}
          >
            <span className="text-primary">●●●</span>
            <span className="text-foreground/70">Used by 2,400+ teams</span>
          </div>
        </motion.div>

        {/* Headline */}
        <motion.h1
          variants={fadeUp}
          className="font-display text-foreground leading-[1.05] tracking-tight mb-4"
          style={{ fontSize: "clamp(2.6rem, 10vw, 3.4rem)", fontWeight: 800 }}
        >
          Voice surveys,
          <br />
          made easy.
        </motion.h1>

        {/* Sub-copy */}
        <motion.p
          variants={fadeUp}
          className="text-muted-foreground text-lg leading-relaxed mb-auto"
          style={{ fontWeight: 300 }}
        >
          Build once. Share a link. Let your audience answer in their own voice.
        </motion.p>

        {/* CTA */}
        <motion.div variants={fadeUp} className="mt-8 flex flex-col gap-3 w-full">
          <motion.button
            onClick={onCreateAgent}
            className="w-full py-5 rounded-2xl bg-primary text-primary-foreground font-display text-lg tracking-wide glow-primary"
            style={{ fontWeight: 700 }}
            whileTap={{ scale: 0.96, transition: { duration: 0.08 } }}
            whileHover={{ filter: "brightness(1.1)", transition: { duration: 0.15 } }}
          >
            Create voice agent →
          </motion.button>
          <p className="text-center text-muted-foreground text-xs">
            Free to start · No account required
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}
