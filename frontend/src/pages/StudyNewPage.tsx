import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronLeft, LoaderCircle } from "lucide-react";
import PhoneScreen from "@/components/participant/PhoneScreen";
import OtpScreen from "@/components/participant/OtpScreen";
import { MoneyInput } from "@/components/creator/MoneyInput";
import { dollarsToCents } from "@/components/creator/studyUi";
import { labelClass } from "@/components/study/BriefBoard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { transitionSmall } from "@/lib/animations";
import { sendOtp, type ConfirmationResult } from "@/lib/firebase";
import { captureException, identifyUser, trackEvent } from "@/lib/posthog";
import { getDeviceAuth, saveDeviceAuth } from "@/lib/sessionStore";
import { loginByPhone, sendWhatsAppOtp, type PhoneProof } from "@/api/client";
import { apiErrorMessage, createStudy, type CreateStudyInput } from "@/api/study";

/** form: the brief. phone / otp: signing in on the way. starting: verified, the study is being made. */
type Stage = "form" | "phone" | "otp" | "starting";

const BRIEF_MIN_CHARS = 20;
const BRIEF_MAX_CHARS = 20_000;
const QUESTION_MIN_CHARS = 8;
const QUESTIONS_MAX = 12;
// The sign in the money fields and the code on the wire.
const CURRENCY = "USD";

const card = "rounded-m bg-card p-m flex flex-col";
const field = "flex flex-col gap-xs";
const help = "text-xs text-muted-foreground";

/**
 * One question per line. A pasted list keeps its questions and loses its
 * numbering ("1. ", "2) ", "- "); lines too short to be a question are left out.
 */
function parseQuestions(text: string): { questions: string[]; tooShort: number; over: number } {
  const lines = text
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•–]|\d{1,2}[.)])\s+/, "").trim().replace(/\s+/g, " "))
    .filter(Boolean);
  const usable = lines.filter((line) => line.length >= QUESTION_MIN_CHARS);
  return {
    questions: usable.slice(0, QUESTIONS_MAX),
    tooShort: lines.length - usable.length,
    over: Math.max(0, usable.length - QUESTIONS_MAX),
  };
}

/**
 * `/study/new`: a researcher pastes a brief and gets a study. The agent writes
 * round 1 from it (or takes the team's own questions) and the study opens on
 * its brief. A device without an API key fills in the same form and verifies
 * its number on the way; what was typed lives here, so it survives that detour.
 */
export default function StudyNewPage() {
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>("form");
  /** undefined while the device record is read, null when this device is signed out. */
  const [apiKey, setApiKey] = useState<string | null | undefined>(undefined);
  const [phone, setPhone] = useState("");
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [creating, setCreating] = useState(false);
  const opened = useRef(false);

  const [brief, setBrief] = useState("");
  const [title, setTitle] = useState("");
  const [sponsor, setSponsor] = useState("");
  const [reward, setReward] = useState("");
  const [budget, setBudget] = useState("");
  const [ownOpen, setOwnOpen] = useState(false);
  const [ownText, setOwnText] = useState("");

  useEffect(() => {
    getDeviceAuth()
      .then((auth) => {
        setApiKey(auth?.apiKey ?? null);
        if (auth?.phone) setPhone(auth.phone);
        if (!opened.current) {
          opened.current = true;
          trackEvent("study_setup_opened", { signedIn: !!auth?.apiKey });
        }
      })
      .catch(() => setApiKey(null));
  }, []);

  const own = parseQuestions(ownText);
  const canSubmit = brief.trim().length >= BRIEF_MIN_CHARS && !creating;

  /** What goes on the wire: dollars become cents, blanks are left out, hidden questions are not sent. */
  const buildInput = (): CreateStudyInput => {
    const rewardCents = dollarsToCents(reward);
    const budgetCents = dollarsToCents(budget);
    const input: CreateStudyInput = { brief: brief.trim() };
    if (title.trim()) input.title = title.trim();
    if (sponsor.trim()) input.sponsorName = sponsor.trim();
    if (rewardCents) input.rewardCents = rewardCents;
    if (budgetCents) input.budgetCents = budgetCents;
    if (rewardCents || budgetCents) input.currency = CURRENCY;
    if (ownOpen && own.questions.length > 0) input.questions = own.questions;
    return input;
  };

  /** `fresh`: the key was minted a moment ago, so a 401 is not a stale device. */
  const create = async (key: string, fresh: boolean) => {
    setCreating(true);
    try {
      const study = await createStudy(key, buildInput());
      trackEvent("study_setup_created", { surveyId: study.surveyId });
      navigate(`/study/${study.surveyId}`, { replace: true });
    } catch (err) {
      captureException(err, { location: "StudyNewPage.create" });
      setCreating(false);
      if (!fresh && err instanceof Error && /^API 401\b/.test(err.message)) {
        // The key on this device stopped working: verify the number, then create.
        setApiKey(null);
        toast("Verify your number to start the study.");
        setStage("phone");
        return;
      }
      toast.error(apiErrorMessage(err, "Couldn't start the study. Try again."));
      setStage("form");
    }
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    const input = buildInput();
    trackEvent("study_setup_submitted", {
      sponsored: !!input.sponsorName,
      ownQuestions: input.questions?.length ?? 0,
      rewardCents: input.rewardCents ?? 0,
      budgetCents: input.budgetCents ?? 0,
      signedIn: !!apiKey,
    });
    if (!apiKey) {
      setStage("phone");
      return;
    }
    void create(apiKey, false);
  };

  const handlePhone = async (value: string) => {
    setPhone(value);
    try {
      const result = await sendOtp(value, "recaptcha-container");
      setConfirmationResult(result);
      setStage("otp");
    } catch (smsErr) {
      captureException(smsErr, { location: "StudyNewPage.handlePhone.sendOtp" });
      toast("SMS failed, trying WhatsApp...");
      try {
        await sendWhatsAppOtp(value);
        setConfirmationResult(null);
        setStage("otp");
      } catch (waErr) {
        captureException(waErr, { location: "StudyNewPage.handlePhone.sendWhatsAppOtp" });
        toast.error("Couldn't send verification code. Please try again.");
      }
    }
  };

  const handleVerified = async (verifiedPhone: string, proof: PhoneProof) => {
    setStage("starting");
    let key: string;
    try {
      const res = await loginByPhone(proof);
      key = res.apiKey;
      const canonicalPhone = res.phone || verifiedPhone;
      await saveDeviceAuth(canonicalPhone, key);
      identifyUser(canonicalPhone, { role: "creator" });
      setPhone(canonicalPhone);
      setApiKey(key);
    } catch (err) {
      captureException(err, { location: "StudyNewPage.handleVerified" });
      toast.error("Couldn't verify your number. Please try again.");
      setStage("phone");
      return;
    }
    await create(key, true);
  };

  let screen: ReactNode;

  if (stage === "phone") {
    screen = (
      <div key="phone" className="flex h-svh flex-col bg-background" data-testid="study-new-page" data-stage="phone">
        <div className="shrink-0 px-l pt-l">
          <p className={labelClass}>Start a study</p>
          <p className="mt-xxs text-s text-neutral-8">Verify your number once so the study is yours. Everything you typed is kept.</p>
        </div>
        <div className="min-h-0 flex-1">
          <PhoneScreen onNext={handlePhone} onBack={() => setStage("form")} initialValue={phone} />
        </div>
      </div>
    );
  } else if (stage === "otp") {
    screen = (
      <div key="otp" className="h-svh bg-background" data-testid="study-new-page" data-stage="otp">
        <OtpScreen
          phone={phone}
          confirmationResult={confirmationResult}
          onNext={(verifiedPhone, proof) => void handleVerified(verifiedPhone, proof)}
          onBack={() => setStage("phone")}
        />
      </div>
    );
  } else if (stage === "starting") {
    screen = (
      <div key="starting" className="flex h-svh items-center justify-center bg-background px-l" data-testid="study-new-page" data-stage="starting">
        <div className="flex flex-col items-center gap-l text-center" role="status">
          <LoaderCircle size={32} className="animate-spin text-color-1" aria-hidden />
          <div className="flex flex-col gap-xs">
            <h1 className="font-brand text-l sm:text-xl font-heavy text-foreground">Writing the first round…</h1>
            <p className="text-m text-muted-foreground">You'll land on the study's brief.</p>
          </div>
        </div>
      </div>
    );
  } else {
    const ownHelp =
      own.questions.length === 0
        ? "Left empty, the agent writes round 1 from the brief."
        : [
            `${own.questions.length} ${own.questions.length === 1 ? "question" : "questions"} for round 1.`,
            own.over > 0 ? `Only the first ${QUESTIONS_MAX} are used.` : null,
            own.tooShort > 0 ? `Lines under ${QUESTION_MIN_CHARS} characters are left out.` : null,
          ]
            .filter(Boolean)
            .join(" ");

    screen = (
      <div key="form" className="min-h-screen bg-background" data-testid="study-new-page" data-stage="form">
        <div className="mx-auto flex w-full max-w-md flex-col px-m pb-xxl lg:max-w-2xl lg:px-l">
          <header className="flex flex-col gap-xs pt-xl pb-m">
            <div className="flex items-center gap-s">
              <Button type="button" variant="ghost" size="icon" onClick={() => navigate("/")} aria-label="Back to home" className="shrink-0 -ml-xs">
                <ChevronLeft className="!size-6" aria-hidden />
              </Button>
              <h1 className="min-w-0 font-brand text-l font-heavy text-foreground">Start a study</h1>
            </div>
            <p className="text-s text-muted-foreground">Paste the brief. The agent writes the first round and keeps the brief with you from there.</p>
          </header>

          <div className="flex flex-col gap-m">
            <section className={`${card} gap-xs`}>
              <Label htmlFor="study-brief">The brief</Label>
              <Textarea
                id="study-brief"
                rows={10}
                maxLength={BRIEF_MAX_CHARS}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="What the study is for, who it should hear from (your customers, users of competing products), and what you need to learn. Paste your interview guide too if you have one."
                disabled={creating}
                required
                data-testid="study-brief-input"
              />
            </section>

            <section className={`${card} gap-m`}>
              <div className={field}>
                <Label htmlFor="study-title">Title</Label>
                <Input
                  id="study-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                  placeholder="Left blank, the agent names it"
                  autoComplete="off"
                  disabled={creating}
                  data-testid="study-title-input"
                />
              </div>
              <div className={field}>
                <Label htmlFor="study-sponsor">Who commissioned it</Label>
                <Input
                  id="study-sponsor"
                  value={sponsor}
                  onChange={(e) => setSponsor(e.target.value)}
                  maxLength={80}
                  placeholder="Acme, or leave blank for an internal study"
                  autoComplete="off"
                  disabled={creating}
                  aria-describedby="study-sponsor-help"
                  data-testid="study-sponsor-input"
                />
                <p id="study-sponsor-help" className={help}>
                  Participants are told this name hears their answers.
                </p>
              </div>
            </section>

            <section className={`${card} gap-xs`}>
              <div className="grid gap-m sm:grid-cols-2">
                <div className={field}>
                  <Label htmlFor="study-reward">Reward per answer</Label>
                  <MoneyInput
                    id="study-reward"
                    currency={CURRENCY}
                    value={reward}
                    onValueChange={setReward}
                    placeholder="0"
                    disabled={creating}
                    aria-describedby="study-rewards-help"
                    data-testid="study-reward-input"
                  />
                </div>
                <div className={field}>
                  <Label htmlFor="study-budget">Budget for the study</Label>
                  <MoneyInput
                    id="study-budget"
                    currency={CURRENCY}
                    value={budget}
                    onValueChange={setBudget}
                    placeholder="0"
                    disabled={creating}
                    aria-describedby="study-rewards-help"
                    data-testid="study-budget-input"
                  />
                </div>
              </div>
              <p id="study-rewards-help" className={help}>
                Only answers through a personal link are paid. You can change both later.
              </p>
            </section>

            <div className="flex flex-col">
              <Button
                type="button"
                variant="link"
                size="sm"
                className="self-start"
                aria-expanded={ownOpen}
                aria-controls="study-own-questions"
                onClick={() => setOwnOpen((v) => !v)}
                data-testid="study-own-questions-toggle"
              >
                <ChevronDown className={ownOpen ? "rotate-180 transition-transform" : "transition-transform"} aria-hidden />
                I have my own questions for round 1
              </Button>
              <AnimatePresence initial={false}>
                {ownOpen && (
                  <motion.div
                    id="study-own-questions"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={transitionSmall}
                    className="overflow-hidden"
                  >
                    {/* The gap above the card sits inside the animated wrapper, so closing ends without a jump. */}
                    <div className={`${card} mt-xs gap-xs`}>
                      <Textarea
                        rows={6}
                        value={ownText}
                        onChange={(e) => setOwnText(e.target.value)}
                        placeholder="One question per line"
                        aria-label="Your questions for round 1, one per line"
                        aria-describedby="study-questions-help"
                        disabled={creating}
                        data-testid="study-questions-input"
                      />
                      <p id="study-questions-help" className={help}>
                        {ownHelp}
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="flex flex-col gap-s pt-xs">
              <Button type="button" size="lg" className="w-full" disabled={!canSubmit} onClick={handleSubmit} data-testid="study-create">
                {creating ? (
                  <>
                    <LoaderCircle className="animate-spin" aria-hidden />
                    Writing the first round…
                  </>
                ) : (
                  "Start the study"
                )}
              </Button>
              {apiKey === null && <p className={`${help} text-center`}>You'll verify your phone number first.</p>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {screen}
      {/* Firebase's invisible reCAPTCHA mounts here; it stays put across the stages. */}
      <div id="recaptcha-container" style={{ position: "fixed", bottom: 0, right: 0, opacity: 0, pointerEvents: "none" }} />
    </>
  );
}
