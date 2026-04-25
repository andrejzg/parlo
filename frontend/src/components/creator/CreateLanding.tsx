import { motion } from "framer-motion";

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
      {/* Hero gradient — top half (replaces image to avoid asset dependency) */}
      <div className="relative w-full flex-shrink-0 max-h-[30svh]" style={{ height: "36%" }}>
        <div
          className="w-full h-full"
          style={{
            background:
              "radial-gradient(ellipse at 50% 60%, hsla(22,95%,62%,0.15), transparent 70%), linear-gradient(180deg, hsl(225 20% 10%), hsl(225 20% 6%))",
          }}
        />
        {/* Decorative mic icon */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="w-24 h-24 sm:w-28 sm:h-28 rounded-full flex items-center justify-center"
            style={{ background: "hsl(var(--primary) / 0.1)" }}
          >
            <div
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center"
              style={{ background: "hsl(var(--primary) / 0.18)" }}
            >
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"
                  stroke="hsl(22, 95%, 62%)"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8"
                  stroke="hsl(22, 95%, 62%)"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          </div>
        </div>
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
              Parlo
            </span>
          </div>
        </div>
      </div>

      {/* Bottom content — bold text + CTA */}
      <motion.div
        className="flex flex-col px-6 pt-2 pb-8 flex-1"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        {/* Social proof pill */}
        <motion.div variants={fadeUp} className="mb-3 sm:mb-5">
          <div
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium"
            style={{ background: "hsl(var(--secondary))" }}
          >
            <span className="text-primary">///</span>
            <span className="text-foreground/70">Voice surveys, made easy</span>
          </div>
        </motion.div>

        {/* Headline */}
        <motion.h1
          variants={fadeUp}
          className="font-serif text-foreground leading-[1.02] tracking-tight mb-2 sm:mb-4"
          style={{ fontSize: "clamp(2rem, 11vw, 3.8rem)", fontWeight: 600 }}
        >
          Voice surveys,
          <br />
          made easy.
        </motion.h1>

        {/* Sub-copy */}
        <motion.p
          variants={fadeUp}
          className="text-muted-foreground text-base sm:text-lg leading-relaxed mb-auto"
          style={{ fontWeight: 300 }}
        >
          Build once. Share a link. Let your audience answer in their own voice.
        </motion.p>

        {/* CTA */}
        <motion.div variants={fadeUp} className="mt-4 sm:mt-8 flex flex-col gap-3 w-full">
          <motion.button
            onClick={onCreateAgent}
            className="w-full py-5 rounded-2xl text-primary-foreground font-display text-lg tracking-wide"
            style={{
              fontWeight: 700,
              background: "linear-gradient(135deg, hsl(215 90% 54%), hsl(215 90% 62%))",
              boxShadow: "0 4px 24px hsl(215 90% 45% / 0.4)",
            }}
            whileTap={{ scale: 0.96, transition: { duration: 0.08 } }}
            whileHover={{ filter: "brightness(1.1)", transition: { duration: 0.15 } }}
          >
            Create voice agent
          </motion.button>
          <p className="text-center text-muted-foreground text-xs">
            Free to start · No account required
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}
