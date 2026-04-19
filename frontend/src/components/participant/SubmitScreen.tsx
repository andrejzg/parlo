import { useEffect, useState } from "react";
import { motion } from "framer-motion";

interface SubmitScreenProps {
  onSubmitComplete: () => void;
  /** Called to trigger the actual submission. Should resolve when done. */
  onSubmit: () => Promise<void>;
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

export default function SubmitScreen({ onSubmitComplete, onSubmit }: SubmitScreenProps) {
  const [status, setStatus] = useState<"submitting" | "success" | "error">("submitting");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await onSubmit();
        if (!cancelled) {
          setStatus("success");
          // Brief pause so user sees success state, then advance
          setTimeout(() => {
            onSubmitComplete();
          }, 1500);
        }
      } catch (err: any) {
        if (!cancelled) {
          setStatus("error");
          setErrorMsg(err?.message || "Something went wrong");
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <motion.div
      className="flex flex-col items-center justify-center h-full px-6"
      variants={stagger}
      initial="initial"
      animate="animate"
    >
      {status === "submitting" && (
        <motion.div variants={fadeUp} className="flex flex-col items-center gap-6">
          {/* Spinner */}
          <div className="relative flex items-center justify-center">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center"
              style={{ background: "hsl(var(--primary) / 0.12)" }}
            >
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center"
                style={{ background: "hsl(var(--primary) / 0.22)" }}
              >
                <motion.div
                  className="w-6 h-6 rounded-full border-2 border-t-transparent"
                  style={{ borderColor: "hsl(22, 95%, 62%)", borderTopColor: "transparent" }}
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                />
              </div>
            </div>
            <div
              className="absolute inset-0 w-20 h-20 rounded-full border-2 pulse-ring"
              style={{ borderColor: "hsl(var(--primary) / 0.3)" }}
            />
          </div>
          <h2
            className="font-display text-2xl text-center"
            style={{ fontWeight: 800, color: "hsl(40 20% 95%)" }}
          >
            Sending your answers...
          </h2>
          <p className="text-muted-foreground text-sm">
            Almost there...
          </p>
        </motion.div>
      )}

      {status === "success" && (
        <motion.div
          variants={fadeUp}
          initial="initial"
          animate="animate"
          className="flex flex-col items-center gap-6"
        >
          <div className="relative flex items-center justify-center">
            <div className="w-20 h-20 rounded-full bg-primary/15 flex items-center justify-center">
              <div className="w-14 h-14 rounded-full bg-primary/25 flex items-center justify-center">
                <motion.svg
                  width="28"
                  height="28"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="hsl(22, 95%, 62%)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <motion.polyline
                    points="20 6 9 17 4 12"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  />
                </motion.svg>
              </div>
            </div>
            <div className="absolute inset-0 w-20 h-20 rounded-full border-2 border-primary/30 pulse-ring" />
          </div>
          <h2
            className="font-display text-2xl text-center"
            style={{ fontWeight: 800, color: "hsl(40 20% 95%)" }}
          >
            All done!
          </h2>
          <p className="text-muted-foreground text-sm">
            Taking you to the next screen...
          </p>
        </motion.div>
      )}

      {status === "error" && (
        <motion.div
          variants={fadeUp}
          initial="initial"
          animate="animate"
          className="flex flex-col items-center gap-6"
        >
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center"
            style={{ background: "hsl(var(--destructive) / 0.15)" }}
          >
            <span className="text-3xl" style={{ color: "hsl(var(--destructive))" }}>!</span>
          </div>
          <h2
            className="font-display text-2xl text-center"
            style={{ fontWeight: 800, color: "hsl(40 20% 95%)" }}
          >
            Something went wrong
          </h2>
          <p className="text-muted-foreground text-sm text-center">
            {errorMsg}
          </p>
          <motion.button
            onClick={() => {
              setStatus("submitting");
              onSubmit()
                .then(() => {
                  setStatus("success");
                  setTimeout(onSubmitComplete, 1500);
                })
                .catch((err) => {
                  setStatus("error");
                  setErrorMsg(err?.message || "Something went wrong");
                });
            }}
            className="px-8 py-3 rounded-xl bg-primary text-primary-foreground font-display font-semibold text-sm"
            whileTap={{ scale: 0.96 }}
          >
            Try again
          </motion.button>
        </motion.div>
      )}
    </motion.div>
  );
}
