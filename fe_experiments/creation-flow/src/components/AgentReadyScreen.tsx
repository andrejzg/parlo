import { motion } from "framer-motion";
import { VoiceAnswer } from "@/types/survey";

interface AgentReadyScreenProps {
  answers: VoiceAnswer[];
  onDashboard?: () => void;
}

const stagger = {
  animate: { transition: { staggerChildren: 0.09, delayChildren: 0.1 } },
};

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as number[] },
  },
};

export default function AgentReadyScreen({ answers, onDashboard }: AgentReadyScreenProps) {
  return (
    <div
      className="flex flex-col h-full items-center justify-between px-6 py-14"
      style={{ background: "hsl(225 25% 4%)" }}
    >
      {/* Brand mark */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="flex items-center gap-2"
        style={{ opacity: 0.45 }}
      >
        <div className="w-2 h-2 rounded-full bg-primary rec-blink" />
        <span
          className="text-xs font-display tracking-widest uppercase"
          style={{ color: "hsl(225 10% 55%)" }}
        >
          VoiceForm
        </span>
      </motion.div>

      {/* Main */}
      <motion.div
        className="flex flex-col items-center gap-7 w-full"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        {/* Pulse icon */}
        <motion.div variants={fadeUp} className="relative flex items-center justify-center">
          <div
            className="w-24 h-24 rounded-full flex items-center justify-center"
            style={{ background: "hsl(var(--primary) / 0.12)" }}
          >
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{ background: "hsl(var(--primary) / 0.22)" }}
            >
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
                <motion.path
                  d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"
                  stroke="hsl(22, 95%, 62%)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: 0.6, delay: 0.3 }}
                />
                <motion.path
                  d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8"
                  stroke="hsl(22, 95%, 62%)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: 1, opacity: 1 }}
                  transition={{ duration: 0.5, delay: 0.55 }}
                />
              </svg>
            </div>
          </div>
          <div
            className="absolute inset-0 w-24 h-24 rounded-full border-2 pulse-ring"
            style={{ borderColor: "hsl(var(--primary) / 0.3)" }}
          />
        </motion.div>

        {/* Headline */}
        <motion.div variants={fadeUp} className="text-center space-y-3">
          <h1
            className="font-display leading-tight"
            style={{
              fontSize: "clamp(2.4rem, 9vw, 3rem)",
              fontWeight: 800,
              color: "hsl(40 20% 95%)",
            }}
          >
            Your agent
            <br />
            is ready.
          </h1>
          <p
            className="text-lg leading-relaxed font-light"
            style={{ color: "hsl(225 10% 55%)" }}
          >
            Recorded {answers.length} voice instructions. We're building your agent now.
          </p>
        </motion.div>

        {/* Share link card */}
        <motion.div
          variants={fadeUp}
          className="w-full rounded-2xl border p-5"
          style={{
            background: "hsl(225 18% 8%)",
            borderColor: "hsl(225 15% 16%)",
          }}
        >
          <p
            className="font-display text-xs tracking-widest uppercase mb-3"
            style={{ color: "hsl(225 10% 45%)" }}
          >
            Share link
          </p>
          <div
            className="flex items-center gap-3 rounded-xl px-4 py-3"
            style={{ background: "hsl(225 15% 12%)" }}
          >
            <span
              className="text-sm flex-1 truncate font-mono"
              style={{ color: "hsl(40 20% 80%)" }}
            >
              voiceform.app/s/demo-001
            </span>
            <button
              className="text-xs font-display font-semibold shrink-0"
              style={{ color: "hsl(var(--primary))" }}
              onClick={() => navigator.clipboard.writeText("https://voiceform.app/s/demo-001")}
            >
              Copy
            </button>
          </div>
          <a
            href={`https://wa.me/?text=${encodeURIComponent("Hey! I've set up a voice agent for you. Tap to start: https://voiceform.app/s/demo-001")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-3 w-full rounded-xl py-4 mt-3 font-display font-semibold text-base"
            style={{
              background: "#25D366",
              color: "#fff",
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            Share with WhatsApp
          </a>
          <button
            onClick={onDashboard}
            className="flex items-center justify-center w-full rounded-xl py-4 mt-2 font-display font-semibold text-sm border"
            style={{
              background: "transparent",
              color: "hsl(225 10% 55%)",
              borderColor: "hsl(225 15% 16%)",
            }}
          >
            Go to agent dashboard
          </button>
        </motion.div>
      </motion.div>

      {/* Footer */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8, duration: 0.4 }}
        className="text-xs"
        style={{ color: "hsl(225 10% 35%)" }}
      >
        Powered by{" "}
        <span
          className="font-display"
          style={{ color: "hsl(225 10% 50%)" }}
        >
          VoiceForm
        </span>
      </motion.p>
    </div>
  );
}
