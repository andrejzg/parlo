import { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { stagger, fadeUp, transitionSmall } from "@/lib/animations";
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
      className="flex flex-col items-center justify-between h-full px-l pt-l pb-safe sm:py-xxl"
      variants={stagger}
      initial="initial"
      animate="animate"
    >
      {/* Top row: back button + brand mark */}
      <motion.div variants={fadeUp} className="w-full flex items-center justify-between">
        {onBack ? (
          <Button type="button" variant="ghost" size="icon" onClick={onBack} aria-label="Back" className="-ml-xs">
            <ChevronLeft className="!size-6" aria-hidden />
          </Button>
        ) : (
          <div className="w-11" />
        )}
        <span className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">
          Parlo
        </span>
        <div className="w-11" />
      </motion.div>

      {/* Main content */}
      <div className="flex flex-col items-center gap-l w-full max-w-sm mx-auto">
        <motion.h2
          variants={fadeUp}
          className="font-brand text-l sm:text-xl font-heavy text-center text-foreground"
        >
          Enter the code
        </motion.h2>

        <motion.div
          variants={fadeUp}
          className="flex flex-col items-center gap-xxs"
        >
          <p className="text-m text-muted-foreground text-center">
            {whatsappMode ? "Sent via WhatsApp to " : "Sent via SMS to "}
            <span className="text-foreground font-medium">{maskedPhone}</span>
          </p>
          {onBack && (
            <Button type="button" variant="link" size="sm" onClick={onBack}>
              Wrong number? Change it
            </Button>
          )}
        </motion.div>

        {/* Code input — one field holding all six digits (auto-verifies at
            six, so paste and OS one-time-code autofill work natively). */}
        <motion.div variants={fadeUp} className="w-full">
          <Input
            ref={inputRef}
            type="tel"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="000000"
            aria-label="Verification code"
            aria-invalid={error ? true : undefined}
            autoFocus
            disabled={verifying}
            data-1p-ignore
            data-lpignore="true"
            data-bwignore
            data-form-type="other"
            className={cn(
              // Digits read as data: one text step up, centred. The spacing
              // between digits borrows the xs space token because the
              // tracking scale tops out at 0.02em; an arbitrary *property*
              // is used so it reliably overrides the field's tracking-l.
              "h-16 text-center font-data text-l font-medium [letter-spacing:var(--space-xs)]",
              code.length === CODE_LENGTH && "shadow-edge-accent",
            )}
          />
        </motion.div>

        {/* Error message */}
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={transitionSmall}
            className="text-xs text-error"
          >
            {error}
          </motion.p>
        )}

        {/* Verifying state */}
        {verifying && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={transitionSmall}
            className="text-s text-muted-foreground"
          >
            Verifying...
          </motion.p>
        )}

        {/* Resend + WhatsApp fallback */}
        <motion.div variants={fadeUp} className="flex flex-col items-center gap-xs">
          {secondsLeft > 0 ? (
            <p className="text-s text-muted-foreground tabular-nums">
              Resend code in {secondsLeft}s
            </p>
          ) : (
            <Button type="button" variant="link" size="sm" onClick={handleResend}>
              Resend code
            </Button>
          )}

          {!whatsappMode && (
            <Button
              type="button"
              variant="secondary"
              onClick={handleWhatsAppFallback}
              disabled={whatsappSending}
            >
              {whatsappSending ? "Sending..." : "Didn't get it? Try WhatsApp"}
            </Button>
          )}
        </motion.div>
      </div>

      {/* Spacer to match layout */}
      <div />
    </motion.div>
  );
}
