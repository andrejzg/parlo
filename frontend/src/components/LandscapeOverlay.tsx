import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { EASE, transitionLarge } from "@/lib/animations";

function useIsLandscape() {
  const [isLandscape, setIsLandscape] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(orientation: landscape) and (max-height: 500px)");
    const update = () => setIsLandscape(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return isLandscape;
}

export default function LandscapeOverlay() {
  const isLandscape = useIsLandscape();

  return (
    <AnimatePresence>
      {isLandscape && (
        <motion.div
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-xl px-xl bg-background"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={transitionLarge}
        >
          {/* Phone with rotation arrow */}
          <motion.div
            className="relative"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={transitionLarge}
          >
            <svg
              width="120"
              height="120"
              viewBox="0 0 120 120"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden
            >
              {/* Phone body (landscape orientation) */}
              <motion.rect
                x="16"
                y="36"
                width="88"
                height="52"
                rx="8"
                className="stroke-color-1"
                strokeWidth="2.5"
                fill="none"
                initial={{ rotate: 0 }}
                animate={{ rotate: -90 }}
                transition={{
                  duration: 1.2,
                  delay: 0.6,
                  ease: EASE,
                  repeat: Infinity,
                  repeatDelay: 2,
                }}
                style={{ transformOrigin: "60px 62px" }}
              />
              {/* Home indicator */}
              <motion.line
                x1="50"
                y1="80"
                x2="70"
                y2="80"
                className="stroke-color-1"
                strokeWidth="2"
                strokeLinecap="round"
                opacity={0.5}
                initial={{ rotate: 0 }}
                animate={{ rotate: -90 }}
                transition={{
                  duration: 1.2,
                  delay: 0.6,
                  ease: EASE,
                  repeat: Infinity,
                  repeatDelay: 2,
                }}
                style={{ transformOrigin: "60px 62px" }}
              />
            </svg>
          </motion.div>

          {/* Text */}
          <motion.div
            className="text-center flex flex-col gap-xs"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={transitionLarge}
          >
            <h2 className="font-brand text-l font-medium text-foreground">Rotate your phone</h2>
            <p className="text-s text-muted-foreground">This experience works best in portrait mode</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
