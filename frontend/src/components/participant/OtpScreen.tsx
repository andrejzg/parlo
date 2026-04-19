import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { stagger, fadeUp } from "@/lib/animations";
import type { ConfirmationResult } from "@/lib/firebase";
import { sendWhatsAppOtp, verifyWhatsAppOtp } from "@/api/client";
import { captureException } from "@/lib/posthog";

interface OtpScreenProps {
  phone: string;
  confirmationResult: ConfirmationResult | null;
  onNext: (phone: string) => void;
  onBack?: () => void;
}

const CODE_LENGTH = 6;
const RESEND_COOLDOWN = 60; // seconds

export default function OtpScreen({ phone, confirmationResult, onNext, onBack }: OtpScreenProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_COOLDOWN);
  // If we don't have a Firebase confirmationResult, we're already in WhatsApp mode
  // (the parent already sent the code via Kapso as a fallback)
  const [whatsappMode, setWhatsappMode] = useState(!confirmationResult);
  const [whatsappSending, setWhatsappSending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Countdown timer
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  // Auto-verify when code reaches 6 digits
  const verify = useCallback(
    async (otp: string) => {
      if (otp.length !== CODE_LENGTH || verifying) return;
      setVerifying(true);
      setError("");

      try {
        if (whatsappMode) {
          const result = await verifyWhatsAppOtp(phone, otp);
          if (!result.verified) {
            setError("Invalid code. Please try again.");
            setCode("");
            inputRef.current?.focus();
            setVerifying(false);
            return;
          }
        } else {
          if (!confirmationResult) {
            setError("Verification session expired. Please go back and try again.");
            setVerifying(false);
            return;
          }
          await confirmationResult.confirm(otp);
        }
        onNext(phone);
      } catch (err) {
        captureException(err, { location: "OtpScreen.verify", whatsappMode });
        setError("Invalid code. Please try again.");
        setCode("");
        inputRef.current?.focus();
        setVerifying(false);
      }
    },
    [confirmationResult, whatsappMode, phone, onNext, verifying],
  );

  const handleChange = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, CODE_LENGTH);
    setCode(digits);
    setError("");
    if (digits.length === CODE_LENGTH) {
      verify(digits);
    }
  };

  const handleWhatsAppFallback = async () => {
    setWhatsappSending(true);
    setError("");
    try {
      await sendWhatsAppOtp(phone);
      setWhatsappMode(true);
      setSecondsLeft(RESEND_COOLDOWN);
      setCode("");
      inputRef.current?.focus();
    } catch (err) {
      captureException(err, { location: "OtpScreen.handleWhatsAppFallback" });
      setError("Failed to send WhatsApp code. Please try again.");
    } finally {
      setWhatsappSending(false);
    }
  };

  const handleResend = async () => {
    if (secondsLeft > 0) return;
    if (whatsappMode) {
      await handleWhatsAppFallback();
    } else {
      // For SMS resend, user needs to go back and re-enter phone (Firebase limitation)
      onBack?.();
    }
  };

  // Format phone for display: show last 4 digits
  const maskedPhone = phone.length > 4
    ? `${"*".repeat(phone.length - 4)}${phone.slice(-4)}`
    : phone;

  return (
    <motion.div
      className="flex flex-col items-center justify-between h-full px-6 pt-6 pb-safe sm:py-12"
      variants={stagger}
      initial="initial"
      animate="animate"
    >
      {/* Top row: back button + brand mark */}
      <motion.div variants={fadeUp} className="w-full flex items-center justify-between">
        {onBack ? (
          <motion.button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1 px-2 py-2 -ml-2 rounded-full text-muted-foreground hover:text-foreground transition-colors select-none"
            whileTap={{ scale: 0.9 }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            <span className="text-sm">Back</span>
          </motion.button>
        ) : (
          <div className="w-10" />
        )}
        <div className="flex items-center gap-2 opacity-50">
          <div className="w-2 h-2 rounded-full bg-primary rec-blink" />
          <span className="text-xs font-display tracking-widest uppercase text-muted-foreground">
            Parlo
          </span>
        </div>
        <div className="w-10" />
      </motion.div>

      {/* Main content */}
      <div className="flex flex-col items-center gap-6 w-full max-w-sm mx-auto">
        <motion.h2
          variants={fadeUp}
          className="font-display text-xl sm:text-3xl leading-snug text-center text-foreground"
          style={{ fontWeight: 800 }}
        >
          Enter the code
        </motion.h2>

        <motion.div
          variants={fadeUp}
          className="flex flex-col items-center gap-1"
        >
          <p className="text-muted-foreground text-base text-center font-light">
            {whatsappMode ? "Sent via WhatsApp to " : "Sent via SMS to "}
            <span className="text-foreground font-medium">{maskedPhone}</span>
          </p>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="text-sm text-primary hover:underline select-none"
            >
              Wrong number? Change it
            </button>
          )}
        </motion.div>

        {/* Code input */}
        <motion.div variants={fadeUp} className="w-full">
          <input
            ref={inputRef}
            type="tel"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="000000"
            aria-label="Verification code"
            autoFocus
            disabled={verifying}
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            data-form-type="other"
            className="w-full h-16 rounded-2xl border px-4 text-center text-2xl tracking-[0.5em] font-mono ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
            style={{
              background: "hsl(225 15% 10%)",
              color: "hsl(40 20% 95%)",
              borderColor: error ? "hsl(0 70% 50%)" : "hsl(225 15% 18%)",
              letterSpacing: "0.5em",
            }}
          />
        </motion.div>

        {/* Error message */}
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-sm text-red-400"
          >
            {error}
          </motion.p>
        )}

        {/* Verifying state */}
        {verifying && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-sm text-muted-foreground"
          >
            Verifying...
          </motion.p>
        )}

        {/* Resend + WhatsApp fallback */}
        <motion.div variants={fadeUp} className="flex flex-col items-center gap-2">
          {secondsLeft > 0 ? (
            <p className="text-sm text-muted-foreground">
              Resend code in {secondsLeft}s
            </p>
          ) : (
            <button
              type="button"
              onClick={handleResend}
              className="text-sm text-primary hover:underline select-none"
            >
              Resend code
            </button>
          )}

          {!whatsappMode && (
            <button
              type="button"
              onClick={handleWhatsAppFallback}
              disabled={whatsappSending}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors select-none disabled:opacity-50"
            >
              {whatsappSending ? "Sending..." : "Didn't get it? Try WhatsApp"}
            </button>
          )}
        </motion.div>
      </div>

      {/* Spacer to match layout */}
      <div />
    </motion.div>
  );
}
