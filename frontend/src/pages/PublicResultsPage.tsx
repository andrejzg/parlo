import { useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Play } from "lucide-react";
import { useGetPublicResults } from "@/api/client";
import { Button } from "@/components/ui/button";
import { fadeUp, stagger, transitionLarge } from "@/lib/animations";

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
      <div className="min-h-screen w-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-m">
          <div className="w-2 h-2 rounded-full bg-color-1 rec-blink" />
          <p className="text-s text-muted-foreground">Loading results...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      {/* max-w-md / max-h-[812px] are the phone-frame shell dimensions (structural). */}
      <div className="relative w-full max-w-md h-screen max-h-[812px] overflow-hidden bg-background">
        <div className="flex flex-col h-full px-l py-xl">
          {/* Header */}
          <motion.div
            className="flex flex-col items-center gap-m mb-xl"
            variants={stagger}
            initial="initial"
            animate="animate"
          >
            <motion.span
              variants={fadeUp}
              className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground"
            >
              Parlo
            </motion.span>

            <motion.h1 variants={fadeUp} className="font-brand text-l font-heavy text-foreground text-center">
              {surveyTitle}
            </motion.h1>

            <motion.p variants={fadeUp} className="text-s text-muted-foreground text-center">
              {results.length} response{results.length !== 1 ? "s" : ""}
            </motion.p>
          </motion.div>

          {/* Results list */}
          <motion.div
            className="flex flex-col gap-xs flex-1 min-h-0 overflow-y-auto"
            variants={stagger}
            initial="initial"
            animate="animate"
          >
            {results.map((result, i) => (
              <motion.div key={i} variants={fadeUp} className="flex items-center gap-m rounded-m bg-card p-m">
                {/* Avatar */}
                <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-muted text-neutral-8 text-s font-medium">
                  {result.firstName.charAt(0)}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-s font-medium text-foreground">{result.firstName}</p>
                  <p className="text-xs text-muted-foreground">
                    {result.answers.length} answer{result.answers.length !== 1 ? "s" : ""}
                  </p>
                </div>

                {/* Play button placeholder */}
                <Button type="button" variant="secondary" size="icon" className="shrink-0" aria-label="Play">
                  <Play fill="currentColor" aria-hidden />
                </Button>
              </motion.div>
            ))}
          </motion.div>

          {/* Footer */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ ...transitionLarge, delay: 0.6 }}
            className="text-center text-xs text-muted-foreground mt-l"
          >
            Powered by <span className="font-brand text-neutral-8">Parlo</span>
          </motion.p>
        </div>
      </div>
    </div>
  );
}
