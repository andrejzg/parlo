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
import { sendWhatsAppOtp, type PhoneProof } from "@/api/client";
import { fetchJoinInfo, joinByInvite, type JoinInfo } from "@/api/study";

type Stage = "loading" | "phone" | "otp" | "joining" | "error";

/**
 * `/join/:token`: an invite to a study's team, as the client or as a
 * co-researcher. A device that already holds an API key takes the seat
 * silently; otherwise phone + code, then the same. Lands on the brief.
 */
export default function JoinPage() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [info, setInfo] = useState<JoinInfo | null>(null);
  const [stage, setStage] = useState<Stage>("loading");
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);

  const finish = async (auth: PhoneProof | { apiKey: string }, fallbackPhone: string) => {
    setStage("joining");
    try {
      const res = await joinByInvite(token, auth);
      const canonicalPhone = res.phone ?? fallbackPhone;
      await saveDeviceAuth(canonicalPhone, res.apiKey);
      if (canonicalPhone) identifyUser(canonicalPhone, { role: "creator" });
      trackEvent("invite_join_completed", { role: res.role, method: "apiKey" in auth ? "api_key" : "proof" });
      navigate(`/study/${res.surveyId}`, { replace: true });
    } catch (err) {
      captureException(err, { location: "JoinPage.finish" });
      const message = err instanceof Error ? err.message : "";
      if (/removed from this study/i.test(message)) {
        setError("You were removed from this study.");
        setStage("error");
        return;
      }
      if (/no longer valid/i.test(message)) {
        setError("This invite link is no longer valid. Ask for a fresh one.");
        setStage("error");
        return;
      }
      // A stale device key or a failed code: verify the number.
      if (!("apiKey" in auth)) toast.error("Couldn't verify your number. Please try again.");
      setStage("phone");
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      trackEvent("invite_link_opened");
      try {
        const data = await fetchJoinInfo(token);
        if (cancelled) return;
        setInfo(data);
      } catch {
        if (cancelled) return;
        setError("This invite link is no longer valid. Ask for a fresh one.");
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
      captureException(smsErr, { location: "JoinPage.handlePhone.sendOtp" });
      toast("SMS failed, trying WhatsApp...");
      try {
        await sendWhatsAppOtp(value);
        setConfirmationResult(null);
        setStage("otp");
      } catch (waErr) {
        captureException(waErr, { location: "JoinPage.handlePhone.sendWhatsAppOtp" });
        toast.error("Couldn't send verification code. Please try again.");
      }
    }
  };

  const title = info?.title ?? "a study";
  const seat = info?.role === "client" ? "as the client" : "as a researcher";
  const what =
    info?.role === "client"
      ? "You'll hear what participants say, shape the questions the study has to answer, and steer what gets asked next."
      : "You'll work on the brief, send rounds and manage the study with the rest of the research team.";

  if (stage === "phone") {
    return (
      <div className="h-svh bg-background">
        <div className="px-l pt-l">
          <p className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">You're invited</p>
          <p className="text-s text-neutral-8 mt-xxs">
            {info?.invitedBy ? `${info.invitedBy} invited you` : "You're invited"} to "{title}" {seat}. {what} Verify your number once to take your seat.
          </p>
        </div>
        <PhoneScreen onNext={handlePhone} initialValue={phone} />
        <div id="recaptcha-container" style={{ position: "fixed", bottom: 0, right: 0, opacity: 0, pointerEvents: "none" }} />
      </div>
    );
  }

  if (stage === "otp") {
    return (
      <div className="h-svh bg-background">
        <OtpScreen phone={phone} confirmationResult={confirmationResult} onNext={(verifiedPhone, proof) => void finish(proof, verifiedPhone)} onBack={() => setStage("phone")} />
        <div id="recaptcha-container" style={{ position: "fixed", bottom: 0, right: 0, opacity: 0, pointerEvents: "none" }} />
      </div>
    );
  }

  return (
    <div className="flex h-svh items-center justify-center bg-background px-l" data-testid="join-page" data-stage={stage}>
      <motion.div className="flex flex-col items-center gap-l text-center" variants={stagger} initial="initial" animate="animate">
        {stage === "error" ? (
          <>
            <motion.h1 variants={fadeUp} className="font-brand text-l sm:text-xl font-heavy text-foreground">
              Can't join this study
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
              {stage === "joining" ? `Taking your seat on "${title}"…` : "One moment…"}
            </motion.h1>
            <motion.p variants={fadeUp} className="text-m text-muted-foreground">
              You'll land on the study's brief.
            </motion.p>
          </>
        )}
      </motion.div>
    </div>
  );
}
