import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import WelcomeScreen from "@/components/participant/WelcomeScreen";
import ConsentScreen from "@/components/ConsentScreen";
import QuestionScreen from "@/components/participant/QuestionScreen";
import PhotoQuestionScreen from "@/components/participant/PhotoQuestionScreen";
import VideoQuestionScreen from "@/components/participant/VideoQuestionScreen";
import PhoneScreen from "@/components/participant/PhoneScreen";
import OtpScreen from "@/components/participant/OtpScreen";
import ReviewScreen from "@/components/participant/ReviewScreen";
import SubmitScreen from "@/components/participant/SubmitScreen";
import ThankYouScreen from "@/components/participant/ThankYouScreen";
import { Survey, VoiceAnswer } from "@/types/survey";
import { pageVariants } from "@/lib/animations";
import {
  useGetSurvey,
  useStartResponse,
  useSubmitResponse,
  refreshUploadUrls,
  sendWhatsAppOtp,
  fetchLinkedInProfile,
  type LinkedInProfile,
} from "@/api/client";
import { uploadAudioBlob } from "@/api/upload";
import { trackEvent, identifyUser } from "@/lib/posthog";
import { toast } from "@/components/ui/sonner";
import { forceReleaseSharedStream } from "@/hooks/useVoiceRecorder";
import {
  getSession,
  saveSession,
  deleteSession,
  getAnswers,
  saveAnswer,
  deleteAnswer as deleteAnswerFromIDB,
  cleanStaleSessions,
  getDeviceAuth,
  saveDeviceAuth,
  type SessionRecord,
} from "@/lib/sessionStore";
import { sendOtp, type ConfirmationResult } from "@/lib/firebase";
import { useVisualViewport } from "@/hooks/useVisualViewport";
import { extractCode } from "@/lib/slug";
import { getMediaMix } from "@/lib/mediaMix";
import { uploadQueue } from "@/lib/uploadQueue";

type Stage =
  | "welcome"
  | "consent"
  | "question"
  | "review"
  | "phone"
  | "otp"
  | "linkedin-connect"
  | "linkedin-success"
  | "submit"
  | "done";

const PARTICIPANT_SESSION_KEY = "parlo-participant-linkedin";

const DEMO_SURVEY: Survey = {
  id: "demo-001",
  code: "demo-001",
  title: "How was your experience?",
  description:
    "Tell us in your own words. No typing — just speak. Takes 2-3 minutes.",
  ctaLabel: "Start recording",
  isOpen: true,
  dashboardCode: "dash-demo-001",
  questions: [
    { id: "q1", text: "What brought you to us today, and what were you hoping to find?", hint: "Question 1 of 3" },
    { id: "q2", text: "Walk us through your experience — what worked, what didn't?", hint: "Question 2 of 3" },
    { id: "q3", text: "If you could change one thing about what you experienced, what would it be?", hint: "Question 3 of 3" },
  ],
};

const UPLOAD_URL_TTL_MS = 8 * 60 * 1000; // 8 min (2 min buffer on 10 min server TTL)

export default function ParticipantPage() {
  useVisualViewport();
  const params = useParams<{ code: string }>();
  // Extract canonical code from URL param (which may be a slug like "lemonade-pirates-2rbee8p6")
  const code = params.code ? extractCode(params.code) : "";
  const surveyQuery = useGetSurvey(code || "");

  const [stage, setStage] = useState<Stage>("welcome");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<VoiceAnswer[]>([]);
  const [phone, setPhone] = useState("");
  const [screenKey, setScreenKey] = useState(0);
  const [direction, setDirection] = useState(1);
  const [responseCode, setResponseCode] = useState("");
  const [redoMode, setRedoMode] = useState(false);
  const [redoReturnStage, setRedoReturnStage] = useState<Stage>("review");
  const [sessionRestored, setSessionRestored] = useState(false);
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [devicePhone, setDevicePhone] = useState<string | null>(null);
  const [linkedInProfile, setLinkedInProfile] = useState<LinkedInProfile | null>(null);

  // Upload session state
  const responseIdRef = useRef<string | null>(null);
  const uploadUrlsRef = useRef<Record<string, string> | null>(null);
  const uploadUrlsCreatedAtRef = useRef<number | null>(null);

  const startResponse = useStartResponse();
  const submitResponse = useSubmitResponse();

  const survey: Survey = surveyQuery.data || DEMO_SURVEY;
  const isDemo = survey === DEMO_SURVEY;
  const mediaMix = getMediaMix(survey.questions);

  // ── Session restore on mount ────────────────────────────────────────

  useEffect(() => {
    if (!code || !surveyQuery.data) return;

    // Hard timeout: never block the UI for more than 1.5s on session restore.
    // If IDB is slow/broken, just start a fresh session.
    const failsafe = setTimeout(() => {
      console.warn("[Parlo] Session restore failsafe — starting fresh");
      setSessionRestored(true);
    }, 1500);

    (async () => {
      // Check for returning device FIRST, unconditionally. A verified
      // participant opening a brand-new survey has no session record for
      // that survey code, but we still need to know they've authenticated
      // previously so we can skip phone + OTP at the end of the flow.
      // (Previously this check was gated behind the session-restore early
      // return, which meant every first visit to a new survey lost the
      // deviceAuth status and asked for the phone again.)
      try {
        const deviceAuth = await getDeviceAuth();
        if (deviceAuth) setDevicePhone(deviceAuth.phone);

        // Check if returning from LinkedIn OAuth
        const params = new URLSearchParams(window.location.search);
        if (params.get("linkedin") === "connected" && deviceAuth?.phone) {
          window.history.replaceState({}, "", window.location.pathname + window.location.hash);
          try {
            const profile = await fetchLinkedInProfile(deviceAuth.phone);
            if (profile.connected) {
              setLinkedInProfile(profile);
              setPhone(deviceAuth.phone);
              setStage("linkedin-success");
              clearTimeout(failsafe);
              setSessionRestored(true);
              return;
            }
          } catch {}
        }
      } catch {
        // localStorage unavailable
      }

      try {
        // Clean stale sessions (older than 24h)
        await cleanStaleSessions(24 * 60 * 60 * 1000).catch(() => {});

        const session = await getSession(code);
        if (!session || session.surveyId !== surveyQuery.data.id) {
          clearTimeout(failsafe);
          setSessionRestored(true);
          return;
        }

        // Restore answers from IDB
        const savedAnswers = await getAnswers(code);
        const restoredAnswers: VoiceAnswer[] = savedAnswers.map((a) => ({
          questionId: a.questionId,
          blob: a.blob ?? undefined,
          url: a.blob ? URL.createObjectURL(a.blob) : undefined,
          durationMs: a.durationMs,
          textContent: a.textContent ?? undefined,
          segments: a.segmentBlobs?.map((s) => ({
            blob: s.blob,
            url: URL.createObjectURL(s.blob),
            durationMs: s.durationMs,
          })),
        }));

        // Restore state
        setStage(session.stage as Stage);
        setQuestionIndex(session.questionIndex);
        setAnswers(restoredAnswers);
        setPhone(session.phone);
        setResponseCode(session.responseCode || "");
        responseIdRef.current = session.responseId;
        uploadUrlsRef.current = session.uploadUrls;
        uploadUrlsCreatedAtRef.current = session.uploadUrlsCreatedAt;
        setScreenKey((k) => k + 1);

        toast("Session restored — pick up where you left off");
      } catch {
        // IDB not available or corrupt — start fresh
      }

      clearTimeout(failsafe);
      setSessionRestored(true);
    })();

    return () => clearTimeout(failsafe);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, surveyQuery.data?.id]);

  // ── Persist state to IDB ────────────────────────────────────────────

  const persistSession = useCallback(
    async (overrides?: Partial<{ stage: Stage; questionIndex: number }>) => {
      if (!code || isDemo || !surveyQuery.data) return;
      try {
        const session: SessionRecord = {
          surveyCode: code,
          surveyId: surveyQuery.data.id,
          responseId: responseIdRef.current,
          responseCode: responseCode || null,
          uploadUrls: uploadUrlsRef.current,
          uploadUrlsCreatedAt: uploadUrlsCreatedAtRef.current,
          stage: overrides?.stage ?? stage,
          questionIndex: overrides?.questionIndex ?? questionIndex,
          phone,
          firstName: "",
          lastName: "",
          createdAt: Date.now(), // will be overwritten by upsert logic below
          updatedAt: Date.now(),
        };
        // Preserve original createdAt on updates
        const existing = await getSession(code);
        if (existing) session.createdAt = existing.createdAt;
        await saveSession(session);
      } catch {
        // IDB write failed — non-critical
      }
    },
    [code, isDemo, surveyQuery.data, stage, questionIndex, phone, responseCode]
  );

  // Persist on meaningful state changes (debounced via the dependency array)
  useEffect(() => {
    if (!sessionRestored || stage === "welcome" || stage === "done") return;
    persistSession();
  }, [stage, questionIndex, phone, responseCode, persistSession, sessionRestored]);

  const persistAnswer = useCallback(
    async (answer: VoiceAnswer) => {
      if (!code || isDemo) return;
      try {
        await saveAnswer({
          id: `${code}:${answer.questionId}`,
          surveyCode: code,
          questionId: answer.questionId,
          blob: answer.blob ?? null,
          segmentBlobs: answer.segments?.map((s) => ({ blob: s.blob!, durationMs: s.durationMs })).filter((s) => s.blob) ?? null,
          durationMs: answer.durationMs,
          textContent: answer.textContent ?? null,
          uploadStatus: "pending",
          updatedAt: Date.now(),
        });
      } catch {
        // Non-critical
      }
    },
    [code, isDemo]
  );

  // ── Upload URL management ───────────────────────────────────────────

  const ensureUploadUrls = useCallback(async (): Promise<Record<string, string> | null> => {
    if (!code || isDemo) return null;

    // Check if existing URLs are still valid
    if (
      uploadUrlsRef.current &&
      uploadUrlsCreatedAtRef.current &&
      Date.now() - uploadUrlsCreatedAtRef.current < UPLOAD_URL_TTL_MS
    ) {
      return uploadUrlsRef.current;
    }

    // Try to refresh if we have a response ID
    if (responseIdRef.current) {
      try {
        const urls = await refreshUploadUrls(responseIdRef.current);
        uploadUrlsRef.current = urls;
        uploadUrlsCreatedAtRef.current = Date.now();
        return urls;
      } catch {
        // Refresh failed — try starting a new session
      }
    }

    // Start a new response session
    try {
      const session = await startResponse.mutateAsync(code);
      responseIdRef.current = session.id;
      setResponseCode(session.code);
      uploadUrlsRef.current = session.uploadUrls;
      uploadUrlsCreatedAtRef.current = Date.now();
      return session.uploadUrls;
    } catch {
      return null; // Offline — will retry later
    }
  }, [code, isDemo, startResponse]);

  // ── Background upload for an answer ─────────────────────────────────

  const enqueueUpload = useCallback(
    async (answer: VoiceAnswer) => {
      if (!answer.blob || !code) return;
      const urls = await ensureUploadUrls();
      if (!urls) return; // Offline — IDB has the blob, will upload at submit
      const uploadUrl = urls[answer.questionId];
      if (!uploadUrl) return;
      uploadQueue.enqueue({
        questionId: answer.questionId,
        blob: answer.blob,
        uploadUrl,
        surveyCode: code,
      });
    },
    [code, ensureUploadUrls]
  );

  // ── Track page open ─────────────────────────────────────────────────

  useEffect(() => {
    if (code) trackEvent("participant_survey_opened", { surveyCode: code });
  }, [code]);

  // ── Navigation helpers ──────────────────────────────────────────────

  const goForward = (nextStage: Stage) => {
    setDirection(1);
    setStage(nextStage);
    setScreenKey((k) => k + 1);
  };

  const goBack = (prevStage: Stage) => {
    setDirection(-1);
    setStage(prevStage);
    setScreenKey((k) => k + 1);
  };

  // ── Stage handlers ──────────────────────────────────────────────────

  const handleStart = () => goForward("consent");

  const handleConsent = async () => {
    trackEvent("consent_accepted", { role: "participant", surveyCode: code });

    // Start response session early (non-blocking) to get presigned URLs
    if (code && !isDemo) {
      ensureUploadUrls().then(() => persistSession({ stage: "question", questionIndex: 0 }));
    }

    goForward("question");
  };

  const handleAnswer = (answer: VoiceAnswer) => {
    setAnswers((prev) => {
      const updated = [...prev];
      const existingIdx = updated.findIndex((a) => a.questionId === answer.questionId);
      if (existingIdx >= 0) {
        updated[existingIdx] = answer;
      } else {
        updated.push(answer);
      }
      return updated;
    });

    // Persist to IDB + enqueue background upload
    persistAnswer(answer);
    enqueueUpload(answer);

    if (redoMode) {
      setRedoMode(false);
      forceReleaseSharedStream();
      goForward(redoReturnStage);
      return;
    }

    const nextIndex = questionIndex + 1;

    if (answers.length === 0) {
      trackEvent("participant_recording_started", { surveyCode: code });
    }

    if (nextIndex >= survey.questions.length) {
      trackEvent("participant_recording_completed", {
        surveyCode: code,
        questionCount: survey.questions.length,
      });
      forceReleaseSharedStream();
      goForward("review");
    } else {
      setDirection(1);
      setQuestionIndex(nextIndex);
      setScreenKey((k) => k + 1);
    }
  };

  const handleBack = () => {
    if (stage === "question" && questionIndex > 0) {
      setDirection(-1);
      setQuestionIndex(questionIndex - 1);
      setScreenKey((k) => k + 1);
    }
  };

  const handlePhoneBack = () => goBack("review");
  const handleOtpBack = () => goBack("phone");

  const handlePhone = async (value: string) => {
    console.log("[Parlo] handlePhone called with", value);
    setPhone(value);
    try {
      console.log("[Parlo] calling Firebase sendOtp...");
      const result = await sendOtp(value, "recaptcha-container");
      console.log("[Parlo] Firebase sendOtp success");
      setConfirmationResult(result);
      goForward("otp");
    } catch (err) {
      console.error("[Parlo] Firebase sendOtp failed:", err);
      toast("SMS failed, trying WhatsApp...");
      // Firebase failed — fall back to WhatsApp OTP automatically
      try {
        console.log("[Parlo] calling WhatsApp sendOtp fallback...");
        await sendWhatsAppOtp(value);
        console.log("[Parlo] WhatsApp sendOtp success");
        setConfirmationResult(null);
        goForward("otp");
      } catch (waErr) {
        console.error("[Parlo] WhatsApp OTP fallback also failed:", waErr);
        toast("Couldn't send verification code. Check your number and try again.");
        throw waErr;
      }
    }
  };

  const handleOtpVerified = async (verifiedPhone: string) => {
    setPhone(verifiedPhone);
    identifyUser(verifiedPhone, { role: "participant" });
    saveDeviceAuth(verifiedPhone).catch(() => {});

    // Check if LinkedIn is already connected
    try {
      const profile = await fetchLinkedInProfile(verifiedPhone);
      if (profile.connected) {
        goForward("submit");
        return;
      }
    } catch {}
    goForward("linkedin-connect");
  };

  const handleSubmit = async () => {
    trackEvent("participant_submitted", { surveyCode: code });

    if (!code || isDemo) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return;
    }

    // 1. Wait for background uploads to finish
    try {
      await uploadQueue.waitForAll();
    } catch {
      // Some failed — we'll retry below with fresh tokens
    }

    // 2. Check IDB for answers that still need uploading
    let pendingAnswers: VoiceAnswer[] = [];
    try {
      const idbAnswers = await getAnswers(code);
      const pendingIds = new Set(
        idbAnswers
          .filter((a) => a.uploadStatus !== "uploaded" && a.blob)
          .map((a) => a.questionId)
      );
      pendingAnswers = answers.filter(
        (a) => a.blob && pendingIds.has(a.questionId)
      );
    } catch {
      // IDB unavailable — fall back to uploading all answers with blobs
      pendingAnswers = answers.filter((a) => a.blob);
    }

    // 3. If there are pending answers, get fresh URLs and upload them
    if (pendingAnswers.length > 0) {
      // Always get fresh tokens — old ones may have been consumed by failed attempts
      let freshUrls: Record<string, string> | null = null;
      if (responseIdRef.current) {
        try {
          freshUrls = await refreshUploadUrls(responseIdRef.current);
          uploadUrlsRef.current = freshUrls;
          uploadUrlsCreatedAtRef.current = Date.now();
        } catch {
          // If refresh fails, try ensureUploadUrls as fallback
          freshUrls = await ensureUploadUrls();
        }
      } else {
        freshUrls = await ensureUploadUrls();
      }

      if (freshUrls) {
        const uploadResults = await Promise.allSettled(
          pendingAnswers.map((a) => {
            const url = freshUrls![a.questionId];
            if (!url) return Promise.resolve();
            return uploadAudioBlob(url, a.blob!);
          })
        );
        const failed = uploadResults.filter((r) => r.status === "rejected");
        if (failed.length > 0) {
          throw new Error(`${failed.length} recording(s) failed to upload`);
        }
      }
    }

    // 4. Submit response
    if (!responseIdRef.current) {
      throw new Error("No response session — please try again");
    }

    await submitResponse.mutateAsync({
      responseId: responseIdRef.current,
      phone,
    });

    // 5. Clean up IDB
    try {
      await deleteSession(code);
    } catch {
      // Non-critical
    }
  };

  const handleSubmitComplete = () => goForward("done");

  const handleRedo = (qIdx: number, returnTo: Stage = "review") => {
    setRedoMode(true);
    setRedoReturnStage(returnTo);
    setQuestionIndex(qIdx);
    setDirection(-1);
    setStage("question");
    setScreenKey((k) => k + 1);
  };

  const handleReviewContinue = async () => {
    // If returning device with verified phone, skip phone + OTP — but check LinkedIn
    if (devicePhone) {
      setPhone(devicePhone);
      identifyUser(devicePhone, { role: "participant" });
      try {
        const profile = await fetchLinkedInProfile(devicePhone);
        if (profile.connected) {
          goForward("submit");
          return;
        }
      } catch {}
      goForward("linkedin-connect");
      return;
    }
    goForward("phone");
  };
  const handleReviewRedo = (qIdx: number) => handleRedo(qIdx, "review");

  const handleDeleteAnswer = () => {
    const qId = survey.questions[questionIndex]?.id;
    if (qId) {
      setAnswers((prev) => prev.filter((a) => a.questionId !== qId));
      if (code) deleteAnswerFromIDB(code, qId).catch(() => {});
    }
  };

  const pageKey = stage === "question" ? `q-${screenKey}` : stage;

  const existingAnswer =
    stage === "question"
      ? answers.find((a) => a.questionId === survey.questions[questionIndex]?.id)
      : undefined;

  // ── Loading / restoring state ───────────────────────────────────────

  if (surveyQuery.isLoading || !sessionRestored) {
    return (
      <div
        className="fixed top-0 left-0 right-0 w-full flex items-center justify-center"
        style={{ background: "var(--gradient-hero)", height: "var(--vvh, 100svh)" }}
      >
        <div className="flex flex-col items-center gap-4">
          <div className="w-2 h-2 rounded-full bg-primary rec-blink" />
          <p className="text-muted-foreground text-sm font-display">Loading survey...</p>
        </div>
      </div>
    );
  }

  if (surveyQuery.isError || !survey) {
    return (
      <div
        className="fixed top-0 left-0 right-0 w-full flex items-center justify-center"
        style={{ background: "var(--gradient-hero)", height: "var(--vvh, 100svh)" }}
      >
        <div className="flex flex-col items-center gap-5 px-8 text-center">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{ background: "hsl(225 15% 10%)" }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="hsl(225 10% 35%)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <div className="space-y-2">
            <h2 className="font-display text-lg font-bold" style={{ color: "hsl(40 20% 95%)" }}>
              Survey not available
            </h2>
            <p className="text-sm" style={{ color: "hsl(225 10% 45%)" }}>
              This survey may have been removed or is no longer accepting responses.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed top-0 left-0 right-0 w-full flex items-center justify-center overflow-hidden"
      style={{ background: "var(--gradient-hero)", height: "var(--vvh, 100svh)" }}
    >
      {/* Persistent reCAPTCHA container — must stay mounted across navigation */}
      <div id="recaptcha-container" style={{ position: "fixed", bottom: 0, right: 0, opacity: 0, pointerEvents: "none" }} />
      <div className="relative w-full sm:max-w-[480px] h-full sm:max-h-[812px] overflow-hidden bg-background sm:rounded-2xl sm:border sm:border-border/30">
        <AnimatePresence mode="sync" initial={false} custom={direction}>
          <motion.div
            key={pageKey}
            className="absolute inset-0"
            variants={pageVariants}
            custom={direction}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            {stage === "welcome" && (
              <WelcomeScreen survey={survey} onStart={handleStart} />
            )}
            {stage === "consent" && (
              <ConsentScreen
                description={mediaMix.consentDescription}
                buttonLabel={mediaMix.isVoiceOnly ? "I agree, start recording" : "I agree, let's start"}
                onConsent={handleConsent}
              />
            )}
            {stage === "question" && (
              survey.questions[questionIndex]?.type === "photo" ? (
                <PhotoQuestionScreen
                  question={survey.questions[questionIndex]}
                  questionIndex={questionIndex}
                  totalQuestions={survey.questions.length}
                  isLast={questionIndex === survey.questions.length - 1}
                  existingAnswer={existingAnswer}
                  isRedo={redoMode}
                  onNext={handleAnswer}
                  onBack={questionIndex > 0 ? handleBack : undefined}
                  onDeleteAnswer={handleDeleteAnswer}
                />
              ) : survey.questions[questionIndex]?.type === "video" ? (
                <VideoQuestionScreen
                  question={survey.questions[questionIndex]}
                  questionIndex={questionIndex}
                  totalQuestions={survey.questions.length}
                  isLast={questionIndex === survey.questions.length - 1}
                  existingAnswer={existingAnswer}
                  isRedo={redoMode}
                  onNext={handleAnswer}
                  onBack={questionIndex > 0 ? handleBack : undefined}
                  onDeleteAnswer={handleDeleteAnswer}
                />
              ) : (
                <QuestionScreen
                  question={survey.questions[questionIndex]}
                  questionIndex={questionIndex}
                  totalQuestions={survey.questions.length}
                  isLast={questionIndex === survey.questions.length - 1}
                  existingAnswer={existingAnswer}
                  onNext={handleAnswer}
                  onBack={questionIndex > 0 ? handleBack : undefined}
                  onDeleteAnswer={handleDeleteAnswer}
                />
              )
            )}
            {stage === "review" && (
              <ReviewScreen
                answers={answers}
                questions={survey.questions}
                onContinue={handleReviewContinue}
                onRedo={handleReviewRedo}
              />
            )}
            {stage === "phone" && (
              <PhoneScreen onNext={handlePhone} onBack={handlePhoneBack} initialValue={phone} />
            )}
            {stage === "otp" && (
              <OtpScreen
                phone={phone}
                confirmationResult={confirmationResult}
                onNext={handleOtpVerified}
                onBack={handleOtpBack}
              />
            )}
            {stage === "linkedin-connect" && (
              <div
                className="flex flex-col items-center justify-between h-full px-6 py-14"
                style={{ background: "hsl(225 25% 4%)" }}
              >
                <div />
                <motion.div
                  className="flex flex-col items-center gap-6"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div
                    className="w-20 h-20 rounded-full flex items-center justify-center"
                    style={{ background: "#0A66C2" }}
                  >
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="#fff">
                      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                    </svg>
                  </div>
                  <div className="text-center space-y-3">
                    <h1
                      className="font-display text-2xl leading-tight"
                      style={{ fontWeight: 800, color: "hsl(40 20% 95%)" }}
                    >
                      One last thing
                    </h1>
                    <p
                      className="text-sm leading-relaxed font-light"
                      style={{ color: "hsl(225 10% 50%)" }}
                    >
                      Connect your LinkedIn so the creator knows who you are. Takes 5 seconds.
                    </p>
                  </div>
                </motion.div>
                <motion.button
                  onClick={() => {
                    // Save current participant session state before redirect
                    try {
                      sessionStorage.setItem(PARTICIPANT_SESSION_KEY, JSON.stringify({
                        phone: devicePhone || phone,
                      }));
                    } catch {}
                    const apiBase = import.meta.env.VITE_API_URL || "/api";
                    const p = devicePhone || phone;
                    const currentPath = window.location.pathname;
                    window.location.href = `${apiBase}/auth/linkedin/start?phone=${encodeURIComponent(p)}&returnTo=${encodeURIComponent(currentPath)}`;
                  }}
                  className="w-full py-5 rounded-2xl font-display text-lg tracking-wide"
                  style={{ fontWeight: 700, background: "#0A66C2", color: "#fff" }}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3, duration: 0.4 }}
                  whileTap={{ scale: 0.96, transition: { duration: 0.07 } }}
                >
                  Continue with LinkedIn
                </motion.button>
              </div>
            )}
            {stage === "linkedin-success" && linkedInProfile && (
              <div
                className="flex flex-col items-center justify-between h-full px-6 py-14"
                style={{
                  background: "linear-gradient(180deg, hsl(210 80% 12%) 0%, hsl(210 60% 8%) 50%, hsl(225 25% 4%) 100%)",
                }}
              >
                <div />
                <motion.div
                  className="flex flex-col items-center gap-6"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                >
                  <motion.div
                    className="relative"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.2, type: "spring", stiffness: 300, damping: 20 }}
                  >
                    <div
                      className="w-28 h-28 rounded-full flex items-center justify-center"
                      style={{ background: "hsl(210 70% 20% / 0.4)", border: "2px solid hsl(210 70% 35% / 0.3)" }}
                    >
                      {linkedInProfile.photoUrl ? (
                        <img src={linkedInProfile.photoUrl} alt={linkedInProfile.name ?? ""} className="w-24 h-24 rounded-full object-cover" />
                      ) : (
                        <div className="w-24 h-24 rounded-full flex items-center justify-center font-display text-3xl font-bold" style={{ background: "#0A66C2", color: "#fff" }}>
                          {(linkedInProfile.name ?? "?").charAt(0)}
                        </div>
                      )}
                    </div>
                    <motion.div
                      className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full flex items-center justify-center"
                      style={{ background: "#0A66C2", border: "3px solid hsl(210 60% 8%)" }}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.5, type: "spring", stiffness: 400, damping: 15 }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M20 6L9 17l-5-5" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </motion.div>
                  </motion.div>
                  <motion.div
                    className="text-center space-y-2"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.35, duration: 0.4 }}
                  >
                    <h1 className="font-display text-2xl leading-tight" style={{ fontWeight: 800, color: "hsl(40 20% 95%)" }}>
                      You're connected!
                    </h1>
                    <p className="text-lg font-display font-semibold" style={{ color: "hsl(210 60% 70%)" }}>
                      {linkedInProfile.name}
                    </p>
                  </motion.div>
                </motion.div>
                <motion.button
                  onClick={() => goForward("submit")}
                  className="w-full py-5 rounded-2xl font-display text-lg tracking-wide"
                  style={{ fontWeight: 700, background: "#0A66C2", color: "#fff" }}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6, duration: 0.4 }}
                  whileTap={{ scale: 0.96, transition: { duration: 0.07 } }}
                >
                  Continue
                </motion.button>
              </div>
            )}
            {stage === "submit" && (
              <SubmitScreen
                onSubmit={handleSubmit}
                onSubmitComplete={handleSubmitComplete}
              />
            )}
            {stage === "done" && (
              <ThankYouScreen
                answers={answers}
                questions={survey.questions}
                surveyCode={code || "demo"}
                surveyTitle={survey.title}
                responseCode={responseCode || undefined}
                onRedo={(qIdx) => handleRedo(qIdx, "done")}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
