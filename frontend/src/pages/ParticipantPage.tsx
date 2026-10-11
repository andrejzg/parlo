import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, CircleX } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import GroupReportScreen from "@/components/participant/GroupReportScreen";
import { Survey, SurveyQuestion, VoiceAnswer } from "@/types/survey";
import { MOTION, pageVariants, transitionLarge } from "@/lib/animations";
import { useGetSurvey, useStartResponse, useSubmitResponse, refreshUploadUrls, sendWhatsAppOtp, fetchLinkedInProfile, type LinkedInProfile, loginByPhone, startLinkedIn, type PhoneProof } from "@/api/client";
import { uploadAudioBlob } from "@/api/upload";
import { trackEvent, identifyUser, captureException } from "@/lib/posthog";
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
  clearDeviceAuth,
  type SessionRecord,
} from "@/lib/sessionStore";
import { sendOtp, type ConfirmationResult } from "@/lib/firebase";
import { useVisualViewport } from "@/hooks/useVisualViewport";
import { extractCode } from "@/lib/slug";
import { getMediaMix } from "@/lib/mediaMix";
import { uploadQueue } from "@/lib/uploadQueue";
import { getMemberToken, readTokenFromUrl, saveMemberToken } from "@/lib/memberToken";
import { visibilityCopy } from "@/lib/visibility";

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
  | "done"
  | "report";

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
  // Member token: from a personal link (?t=) or a previous visit on this device.
  const [memberToken, setMemberToken] = useState<string | null>(() => {
    if (!code) return null;
    const fromUrl = readTokenFromUrl();
    if (fromUrl) {
      saveMemberToken(code, fromUrl);
      return fromUrl;
    }
    return getMemberToken(code);
  });
  const surveyQuery = useGetSurvey(code || "", memberToken);

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
  // A device that passed the OTP holds an API key; that key, not the phone, is what identifies the member.
  const [deviceApiKey, setDeviceApiKey] = useState<string | null>(null);
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

  // The asks this visitor is answering in this session. Snapshotted when the
  // flow starts: after submit the personalised survey refetches with those
  // asks gone, but Review / Thank you still need them.
  const flowQuestionsRef = useRef<SurveyQuestion[] | null>(null);
  const flowQuestions = flowQuestionsRef.current ?? survey.questions;
  const mediaMix = getMediaMix(flowQuestions);
  const vis = visibilityCopy(survey.visibility);
  const isMember = !!survey.member;
  const pendingCount = survey.questions.length;
  const [landedOnReport, setLandedOnReport] = useState(false);

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
        // A device verified before API keys were handed out can't prove who
        // it is any more; it goes through the OTP once more.
        if (deviceAuth && !deviceAuth.apiKey) await clearDeviceAuth();
        if (deviceAuth?.apiKey) {
          setDevicePhone(deviceAuth.phone);
          setDeviceApiKey(deviceAuth.apiKey);
        }

        // Check if returning from LinkedIn OAuth
        const params = new URLSearchParams(window.location.search);
        if (params.get("linkedin") === "connected" && deviceAuth?.apiKey) {
          window.history.replaceState({}, "", window.location.pathname + window.location.hash);
          try {
            const profile = await fetchLinkedInProfile(deviceAuth.apiKey);
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
          // A member with nothing left to answer lands on the group's report.
          if (surveyQuery.data.member && surveyQuery.data.questions.length === 0 && !landedOnReport) {
            setLandedOnReport(true);
            setStage("report");
          }
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
      const session = await startResponse.mutateAsync({ code, token: memberToken });
      responseIdRef.current = session.id;
      setResponseCode(session.code);
      uploadUrlsRef.current = session.uploadUrls;
      uploadUrlsCreatedAtRef.current = Date.now();
      return session.uploadUrls;
    } catch {
      return null; // Offline — will retry later
    }
  }, [code, isDemo, startResponse, memberToken]);

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

  const handleStart = () => {
    flowQuestionsRef.current = survey.questions;
    goForward("consent");
  };

  const handleConsent = async () => {
    trackEvent("consent_accepted", { role: "participant", surveyCode: code, visibility: survey.visibility ?? "private", round: survey.round?.number ?? 1 });
    if (!flowQuestionsRef.current) flowQuestionsRef.current = survey.questions;

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

    if (nextIndex >= flowQuestions.length) {
      trackEvent("participant_recording_completed", {
        surveyCode: code,
        questionCount: flowQuestions.length,
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

  const handleOtpVerified = async (verifiedPhone: string, proof: PhoneProof) => {
    // Trade the proof for this device's API key. That key identifies the
    // member on submit (answering is joining) and for LinkedIn.
    let key: string;
    let canonicalPhone = verifiedPhone;
    try {
      const login = await loginByPhone(proof);
      key = login.apiKey;
      canonicalPhone = login.phone;
    } catch (err) {
      captureException(err, { location: "ParticipantPage.handleOtpVerified" });
      toast("Couldn't verify your number. Please try again.");
      goBack("phone");
      return;
    }
    setPhone(canonicalPhone);
    setDevicePhone(canonicalPhone);
    setDeviceApiKey(key);
    identifyUser(canonicalPhone, { role: "participant" });
    saveDeviceAuth(canonicalPhone, key).catch(() => {});

    // Check if LinkedIn is already connected
    try {
      const profile = await fetchLinkedInProfile(key);
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

    const result = await submitResponse.mutateAsync({
      responseId: responseIdRef.current,
      phone,
      apiKey: deviceApiKey ?? undefined,
    });
    if (result?.memberToken) {
      saveMemberToken(code, result.memberToken);
      setMemberToken(result.memberToken);
      trackEvent("participant_joined_group", { surveyCode: code, visibility: result.visibility });
    }

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
    if (devicePhone && deviceApiKey) {
      setPhone(devicePhone);
      identifyUser(devicePhone, { role: "participant" });
      try {
        const profile = await fetchLinkedInProfile(deviceApiKey);
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
    const qId = flowQuestions[questionIndex]?.id;
    if (qId) {
      setAnswers((prev) => prev.filter((a) => a.questionId !== qId));
      if (code) deleteAnswerFromIDB(code, qId).catch(() => {});
    }
  };

  const pageKey = stage === "question" ? `q-${screenKey}` : stage;

  const existingAnswer =
    stage === "question"
      ? answers.find((a) => a.questionId === flowQuestions[questionIndex]?.id)
      : undefined;

  /** From the report: start answering whatever is pending now. */
  const handleAnswerFromReport = () => {
    flowQuestionsRef.current = survey.questions;
    setAnswers([]);
    setQuestionIndex(0);
    setRedoMode(false);
    responseIdRef.current = null;
    uploadUrlsRef.current = null;
    uploadUrlsCreatedAtRef.current = null;
    goForward("consent");
  };

  const handleSeeReport = () => {
    surveyQuery.refetch();
    goForward("report");
  };

  // ── Loading / restoring state ───────────────────────────────────────

  // `--vvh` is the visual-viewport height from useVisualViewport (structural,
  // not a theme value), so it stays inline on the page shells below.
  if (surveyQuery.isLoading || !sessionRestored) {
    return (
      <div
        className="fixed top-0 left-0 right-0 w-full flex items-center justify-center bg-background"
        style={{ height: "var(--vvh, 100svh)" }}
      >
        <div className="flex flex-col items-center gap-m">
          <div className="w-2 h-2 rounded-full bg-color-1 rec-blink" />
          <p className="text-s text-muted-foreground">Loading parlo...</p>
        </div>
      </div>
    );
  }

  if (surveyQuery.isError || !survey) {
    return (
      <div
        className="fixed top-0 left-0 right-0 w-full flex items-center justify-center bg-background"
        style={{ height: "var(--vvh, 100svh)" }}
      >
        <div className="flex flex-col items-center gap-l px-xl text-center">
          <div className="w-14 h-14 rounded-full flex items-center justify-center bg-card text-neutral-6">
            <CircleX size={24} aria-hidden />
          </div>
          <div className="flex flex-col gap-xs">
            <h2 className="font-brand text-l font-heavy text-foreground">Parlo not available</h2>
            <p className="text-m text-muted-foreground">
              This parlo may have been removed or is no longer accepting responses.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed top-0 left-0 right-0 w-full flex items-center justify-center overflow-hidden bg-background"
      style={{ height: "var(--vvh, 100svh)" }}
    >
      {/* Persistent reCAPTCHA container — must stay mounted across navigation (positioning only, kept off-screen) */}
      <div id="recaptcha-container" style={{ position: "fixed", bottom: 0, right: 0, opacity: 0, pointerEvents: "none" }} />
      {/* sm:max-w-[480px] / sm:max-h-[812px] are the phone-frame shell dimensions (structural). */}
      <div className="relative w-full sm:max-w-[480px] h-full sm:max-h-[812px] overflow-hidden bg-background sm:rounded-xl sm:shadow-edge">
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
              <WelcomeScreen
                survey={survey}
                onStart={handleStart}
                onSeeReport={isMember ? handleSeeReport : undefined}
              />
            )}
            {stage === "report" && (
              <GroupReportScreen
                survey={survey}
                code={code}
                token={memberToken}
                pendingCount={pendingCount}
                onAnswer={handleAnswerFromReport}
                onRefresh={() => surveyQuery.refetch()}
              />
            )}
            {stage === "consent" && (
              <ConsentScreen
                description={`${mediaMix.consentDescription} ${vis.consent}`}
                buttonLabel={mediaMix.isVoiceOnly ? "I agree, start recording" : "I agree, let's start"}
                onConsent={handleConsent}
              />
            )}
            {stage === "question" && (
              flowQuestions[questionIndex]?.type === "photo" ? (
                <PhotoQuestionScreen
                  question={flowQuestions[questionIndex]}
                  questionIndex={questionIndex}
                  totalQuestions={flowQuestions.length}
                  isLast={questionIndex === flowQuestions.length - 1}
                  existingAnswer={existingAnswer}
                  isRedo={redoMode}
                  onNext={handleAnswer}
                  onBack={questionIndex > 0 ? handleBack : undefined}
                  onDeleteAnswer={handleDeleteAnswer}
                />
              ) : flowQuestions[questionIndex]?.type === "video" ? (
                <VideoQuestionScreen
                  question={flowQuestions[questionIndex]}
                  questionIndex={questionIndex}
                  totalQuestions={flowQuestions.length}
                  isLast={questionIndex === flowQuestions.length - 1}
                  existingAnswer={existingAnswer}
                  isRedo={redoMode}
                  onNext={handleAnswer}
                  onBack={questionIndex > 0 ? handleBack : undefined}
                  onDeleteAnswer={handleDeleteAnswer}
                />
              ) : (
                <QuestionScreen
                  question={flowQuestions[questionIndex]}
                  questionIndex={questionIndex}
                  totalQuestions={flowQuestions.length}
                  isLast={questionIndex === flowQuestions.length - 1}
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
                questions={flowQuestions}
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
              <div className="flex flex-col items-center justify-between h-full px-l pt-xxl pb-safe sm:py-xxl bg-background">
                <div />
                <motion.div
                  className="flex flex-col items-center gap-l"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={transitionLarge}
                >
                  {/* LinkedIn glyph is third-party artwork; the vendor's own blue is kept for recognition. */}
                  <div className="w-20 h-20 rounded-full flex items-center justify-center bg-linkedin text-neutral-1 dark:text-neutral-10">
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                    </svg>
                  </div>
                  <div className="text-center flex flex-col gap-s">
                    <h1 className="font-brand text-l font-heavy text-foreground">One last thing</h1>
                    <p className="text-m text-neutral-8">
                      Connect your LinkedIn so the creator knows who you are. Takes 5 seconds.
                    </p>
                  </div>
                </motion.div>
                <motion.div
                  className="w-full"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...transitionLarge, delay: 0.3 }}
                >
                  <Button
                    size="lg"
                    className="w-full bg-linkedin text-neutral-1 dark:text-neutral-10"
                    onClick={async () => {
                      if (!deviceApiKey) {
                        toast("Please verify your number first.");
                        goBack("phone");
                        return;
                      }
                      // Save current participant session state before redirect
                      try {
                        sessionStorage.setItem(PARTICIPANT_SESSION_KEY, JSON.stringify({
                          phone: devicePhone || phone,
                        }));
                      } catch {}
                      try {
                        const { url } = await startLinkedIn(deviceApiKey, window.location.pathname);
                        window.location.href = url;
                      } catch {
                        toast("Couldn't reach LinkedIn. Please try again.");
                      }
                    }}
                  >
                    Continue with LinkedIn
                  </Button>
                </motion.div>
              </div>
            )}
            {stage === "linkedin-success" && linkedInProfile && (
              <div className="flex flex-col items-center justify-between h-full px-l pt-xxl pb-safe sm:py-xxl bg-background">
                <div />
                <motion.div
                  className="flex flex-col items-center gap-l"
                  initial={{ opacity: 0, scale: MOTION.popupScale }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={transitionLarge}
                >
                  <motion.div
                    className="relative"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ ...transitionLarge, delay: 0.2 }}
                  >
                    <div className="w-28 h-28 rounded-full flex items-center justify-center bg-muted">
                      {linkedInProfile.photoUrl ? (
                        <img src={linkedInProfile.photoUrl} alt={linkedInProfile.name ?? ""} className="w-24 h-24 rounded-full object-cover" />
                      ) : (
                        <div className="w-24 h-24 rounded-full flex items-center justify-center font-brand text-xl font-medium bg-linkedin text-neutral-1 dark:text-neutral-10">
                          {(linkedInProfile.name ?? "?").charAt(0)}
                        </div>
                      )}
                    </div>
                    {/* Ring is a box shadow in the page background colour (no native border). */}
                    <motion.div
                      className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full flex items-center justify-center bg-linkedin text-neutral-1 dark:text-neutral-10 shadow-[0_0_0_3px_var(--background)]"
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ ...transitionLarge, delay: 0.5 }}
                    >
                      <Check size={16} aria-hidden />
                    </motion.div>
                  </motion.div>
                  <motion.div
                    className="text-center flex flex-col gap-xs"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...transitionLarge, delay: 0.35 }}
                  >
                    <h1 className="font-brand text-l font-heavy text-foreground">You're connected!</h1>
                    <p className="font-brand text-m font-medium text-neutral-8">{linkedInProfile.name}</p>
                  </motion.div>
                </motion.div>
                <motion.div
                  className="w-full"
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...transitionLarge, delay: 0.6 }}
                >
                  <Button size="lg" className="w-full" onClick={() => goForward("submit")}>
                    Continue
                  </Button>
                </motion.div>
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
                questions={flowQuestions}
                surveyCode={code || "demo"}
                surveyTitle={survey.title}
                responseCode={responseCode || undefined}
                onRedo={(qIdx) => handleRedo(qIdx, "done")}
                onSeeReport={!isDemo && memberToken ? handleSeeReport : undefined}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
