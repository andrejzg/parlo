import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import PhoneScreen from "@/components/participant/PhoneScreen";
import OtpScreen from "@/components/participant/OtpScreen";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { fadeUp, stagger } from "@/lib/animations";
import { sendOtp, type ConfirmationResult } from "@/lib/firebase";
import { getDeviceAuth, saveDeviceAuth } from "@/lib/sessionStore";
import { captureException, identifyUser, trackEvent } from "@/lib/posthog";
import { claimByToken, fetchClaimInfo, sendWhatsAppOtp, type ClaimInfo, type PhoneProof } from "@/api/client";

type Stage = "loading" | "phone" | "otp" | "claiming" | "error";

/**
 * `/claim/:token`: the link an agent hands the person it created a parlo for.
 * A device that already holds an API key claims silently and lands on the
 * dashboard; otherwise phone + code, then the same.
 */
export default function ClaimPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [info, setInfo] = useState<ClaimInfo | null>(null);
  const [stage, setStage] = useState<Stage>("loading");
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);

  const finish = async (auth: PhoneProof | { apiKey: string }, fallbackPhone: string) => {
    setStage("claiming");
    try {
      const res = await claimByToken(token, auth);
      const canonicalPhone = res.phone ?? fallbackPhone;
      await saveDeviceAuth(canonicalPhone, res.apiKey);
      if (canonicalPhone) identifyUser(canonicalPhone, { role: "creator" });
      trackEvent("claim_completed", { method: "apiKey" in auth ? "api_key" : "proof" });
      navigate(`/d/${res.dashboardCode}?tab=agent`, { replace: true });
    } catch (err) {
      captureException(err, { location: "ClaimPage.finish" });
      const message = err instanceof Error ? err.message : "";
      if (/belongs to someone else/i.test(message)) {
        setError("This parlo already belongs to someone else.");
        setStage("error");
        return;
      }
      if ("apiKey" in auth) {
        // A stale device key: verify the number instead.
        setStage("phone");
        return;
      }
      toast.error("Couldn't verify your number. Please try again.");
      setStage("phone");
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      trackEvent("claim_link_opened");
      try {
        const data = await fetchClaimInfo(token);
        if (cancelled) return;
        setInfo(data);
      } catch {
        if (cancelled) return;
        setError("This link has expired or was already used.");
        setStage("error");
        return;
      }
      const device = await getDeviceAuth();
      if (cancelled) return;
      if (device?.apiKey) {
        setPhone(device.phone);
        void finish({ apiKey: device.apiKey }, device.phone);
      } else {
        setStage("phone");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handlePhone = async (value: string) => {
    setPhone(value);
    try {
      const result = await sendOtp(value, "recaptcha-container");
      setConfirmationResult(result);
      setStage("otp");
    } catch (smsErr) {
      captureException(smsErr, { location: "ClaimPage.handlePhone.sendOtp" });
      toast("SMS failed, trying WhatsApp...");
      try {
        await sendWhatsAppOtp(value);
        setConfirmationResult(null);
        setStage("otp");
      } catch (waErr) {
        captureException(waErr, { location: "ClaimPage.handlePhone.sendWhatsAppOtp" });
        toast.error("Couldn't send verification code. Please try again.");
      }
    }
  };

  const title = info?.title ?? "your parlo";

  if (stage === "phone") {
    return (
      <div className="h-svh bg-background">
        <div className="px-l pt-l">
          <p className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">Make it yours</p>
          <p className="text-s text-neutral-8 mt-xxs">Your agent made "{title}". Verify your number once and it is yours: the report, the dashboard, the next rounds.</p>
        </div>
        <PhoneScreen onNext={handlePhone} initialValue={phone} />
        <div id="recaptcha-container" style={{ position: "fixed", bottom: 0, right: 0, opacity: 0, pointerEvents: "none" }} />
      </div>
    );
  }

  if (stage === "otp") {
    return (
      <div className="h-svh bg-background">
        <OtpScreen
          phone={phone}
          confirmationResult={confirmationResult}
          onNext={(verifiedPhone, proof) => void finish(proof, verifiedPhone)}
          onBack={() => setStage("phone")}
        />
        <div id="recaptcha-container" style={{ position: "fixed", bottom: 0, right: 0, opacity: 0, pointerEvents: "none" }} />
      </div>
    );
  }

  return (
    <div className="flex h-svh items-center justify-center bg-background px-l">
      <motion.div className="flex flex-col items-center gap-l text-center" variants={stagger} initial="initial" animate="animate">
        {stage === "error" ? (
          <>
            <motion.h1 variants={fadeUp} className="font-brand text-l sm:text-xl font-heavy text-foreground">
              Can't claim this parlo
            </motion.h1>
            <motion.p variants={fadeUp} className="text-m text-muted-foreground">
              {error}
            </motion.p>
            <motion.div variants={fadeUp}>
              <Button asChild>
                <a href="/">Go home</a>
              </Button>
            </motion.div>
          </>
        ) : (
          <>
            <motion.h1 variants={fadeUp} className="font-brand text-l sm:text-xl font-heavy text-foreground">
              {stage === "claiming" ? `Making "${title}" yours…` : "One moment…"}
            </motion.h1>
            <motion.p variants={fadeUp} className="text-m text-muted-foreground">
              Your agent made it. You'll land on its dashboard.
            </motion.p>
          </>
        )}
      </motion.div>
    </div>
  );
}
