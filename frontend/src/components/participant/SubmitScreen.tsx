import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check, CircleAlert, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { stagger, fadeUp, popup } from "@/lib/animations";

interface SubmitScreenProps {
  onSubmitComplete: () => void;
  /** Called to trigger the actual submission. Should resolve when done. */
  onSubmit: () => Promise<void>;
}

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
      className="flex flex-col items-center justify-center h-full px-l"
      variants={stagger}
      initial="initial"
      animate="animate"
    >
      {status === "submitting" && (
        <motion.div variants={fadeUp} className="flex flex-col items-center gap-l">
          {/* Spinner */}
          <div className="relative flex items-center justify-center">
            <div className="w-20 h-20 rounded-full bg-color-1-transparent flex items-center justify-center">
              <div className="w-14 h-14 rounded-full bg-color-1-transparent text-color-1 flex items-center justify-center">
                <Loader2 size={24} className="animate-spin" aria-hidden />
              </div>
            </div>
            {/* Pulsing ring — native borders are zero in this theme, so the
                2px edge is a local inset shadow in the accent's transparent. */}
            <div
              className="absolute inset-0 w-20 h-20 rounded-full shadow-[inset_0_0_0_2px_var(--color-1-transparent)] pulse-ring"
              aria-hidden
            />
          </div>
          <h2 className="font-brand text-l font-heavy text-foreground text-center">
            Sending your answers...
          </h2>
          <p className="text-s text-muted-foreground">
            Almost there...
          </p>
        </motion.div>
      )}

      {status === "success" && (
        <motion.div
          variants={fadeUp}
          initial="initial"
          animate="animate"
          className="flex flex-col items-center gap-l"
        >
          <div className="relative flex items-center justify-center">
            <div className="w-20 h-20 rounded-full bg-success-transparent flex items-center justify-center">
              <div className="w-14 h-14 rounded-full bg-success-transparent text-success flex items-center justify-center">
                <motion.span
                  className="flex"
                  initial={popup.initial}
                  animate={popup.animate}
                  aria-hidden
                >
                  <Check size={28} aria-hidden />
                </motion.span>
              </div>
            </div>
            {/* Pulsing ring — same local 2px inset edge, in the success tint. */}
            <div
              className="absolute inset-0 w-20 h-20 rounded-full shadow-[inset_0_0_0_2px_var(--success-transparent)] pulse-ring"
              aria-hidden
            />
          </div>
          <h2 className="font-brand text-l font-heavy text-foreground text-center">
            All done!
          </h2>
          <p className="text-s text-muted-foreground">
            Taking you to the next screen...
          </p>
        </motion.div>
      )}

      {status === "error" && (
        <motion.div
          variants={fadeUp}
          initial="initial"
          animate="animate"
          className="flex flex-col items-center gap-l"
        >
          <div className="w-20 h-20 rounded-full bg-error-transparent text-error flex items-center justify-center">
            <CircleAlert size={32} aria-hidden />
          </div>
          <h2 className="font-brand text-l font-heavy text-foreground text-center">
            Something went wrong
          </h2>
          <p className="text-s text-muted-foreground text-center">
            {errorMsg}
          </p>
          <Button
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
          >
            Try again
          </Button>
        </motion.div>
      )}
    </motion.div>
  );
}
