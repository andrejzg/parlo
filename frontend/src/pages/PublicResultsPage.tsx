import { useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { useGetPublicResults } from "@/api/client";

const stagger = {
  animate: { transition: { staggerChildren: 0.06, delayChildren: 0.1 } },
};

const fadeUp = {
  initial: { opacity: 0, y: 18 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] as number[] },
  },
};

export default function PublicResultsPage() {
  const { code } = useParams<{ code: string }>();
  const { data, isLoading } = useGetPublicResults(code || "");

  // Mock data for when API is not connected
  const mockResults = [
    { firstName: "Sarah", answers: [{ questionId: "q1", audioUrl: "", durationMs: 45000 }] },
    { firstName: "James", answers: [{ questionId: "q1", audioUrl: "", durationMs: 32000 }] },
    { firstName: "Priya", answers: [{ questionId: "q1", audioUrl: "", durationMs: 51000 }] },
    { firstName: "Alex", answers: [{ questionId: "q1", audioUrl: "", durationMs: 28000 }] },
    { firstName: "Jordan", answers: [{ questionId: "q1", audioUrl: "", durationMs: 39000 }] },
  ];

  const results = data?.results || mockResults;
  const surveyTitle = data?.survey?.title || "Voice Survey Results";

  if (isLoading) {
    return (
      <div
        className="min-h-screen w-full flex items-center justify-center"
        style={{ background: "var(--gradient-hero)" }}
      >
        <div className="flex flex-col items-center gap-4">
          <div className="w-2 h-2 rounded-full bg-primary rec-blink" />
          <p className="text-muted-foreground text-sm font-display">Loading results...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center"
      style={{ background: "var(--gradient-hero)" }}
    >
      <div className="relative w-full max-w-md h-screen max-h-[812px] overflow-hidden bg-background">
        <div
          className="flex flex-col h-full px-6 py-10"
          style={{ background: "hsl(225 25% 4%)" }}
        >
          {/* Header */}
          <motion.div
            className="flex flex-col items-center gap-4 mb-8"
            variants={stagger}
            initial="initial"
            animate="animate"
          >
            <motion.div variants={fadeUp} className="flex items-center gap-2 opacity-50">
              <div className="w-2 h-2 rounded-full bg-primary" />
              <span className="text-xs font-display tracking-widest uppercase text-muted-foreground">
                Parlo
              </span>
            </motion.div>

            <motion.h1
              variants={fadeUp}
              className="font-display text-2xl font-bold text-center"
              style={{ color: "hsl(40 20% 95%)" }}
            >
              {surveyTitle}
            </motion.h1>

            <motion.p
              variants={fadeUp}
              className="text-sm text-center"
              style={{ color: "hsl(225 10% 45%)" }}
            >
              {results.length} response{results.length !== 1 ? "s" : ""}
            </motion.p>
          </motion.div>

          {/* Results list */}
          <motion.div
            className="flex flex-col gap-2 flex-1 overflow-y-auto"
            variants={stagger}
            initial="initial"
            animate="animate"
          >
            {results.map((result, i) => (
              <motion.div
                key={i}
                variants={fadeUp}
                className="flex items-center gap-4 rounded-xl px-4 py-4"
                style={{ background: "hsl(225 15% 8%)" }}
              >
                {/* Avatar */}
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-display font-bold"
                  style={{
                    background: "hsl(var(--primary) / 0.15)",
                    color: "hsl(var(--primary))",
                  }}
                >
                  {result.firstName.charAt(0)}
                </div>

                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm font-display font-semibold"
                    style={{ color: "hsl(40 20% 95%)" }}
                  >
                    {result.firstName}
                  </p>
                  <p className="text-xs" style={{ color: "hsl(225 10% 40%)" }}>
                    {result.answers.length} answer{result.answers.length !== 1 ? "s" : ""}
                  </p>
                </div>

                {/* Play button placeholder */}
                <button
                  className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: "hsl(var(--primary) / 0.12)" }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="hsl(22, 95%, 62%)"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </button>
              </motion.div>
            ))}
          </motion.div>

          {/* Footer */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.4 }}
            className="text-center text-xs mt-6"
            style={{ color: "hsl(225 10% 35%)" }}
          >
            Powered by{" "}
            <span className="font-display" style={{ color: "hsl(225 10% 50%)" }}>
              Parlo
            </span>
          </motion.p>
        </div>
      </div>
    </div>
  );
}
