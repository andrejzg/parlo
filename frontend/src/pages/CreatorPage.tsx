import { useState, useCallback, useRef, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import CreateLanding from "@/components/creator/CreateLanding";
import ConsentScreen from "@/components/ConsentScreen";
import CreationQuestionScreen, { CREATION_QUESTIONS } from "@/components/creator/CreationQuestionScreen";
import BuildingAgentScreen from "@/components/creator/BuildingAgentScreen";
import ReviewQuestionsScreen from "@/components/creator/ReviewQuestionsScreen";
import AgentReadyScreen from "@/components/creator/AgentReadyScreen";
import PhoneScreen from "@/components/participant/PhoneScreen";
import OtpScreen from "@/components/participant/OtpScreen";
import CreatorSidebar, { MenuButton } from "@/components/creator/CreatorSidebar";
import { VoiceAnswer } from "@/types/survey";
import { pageVariants } from "@/lib/animations";
import { trackEvent, identifyUser, captureException } from "@/lib/posthog";
import { forceReleaseSharedStream } from "@/hooks/useVoiceRecorder";
import CreatorHome from "@/components/creator/CreatorHome";
import ProfilePage from "@/components/creator/ProfilePage";
import InboxPage from "@/components/creator/InboxPage";
import ListeningPlayer from "@/components/creator/player/ListeningPlayer";
import { sendOtp, type ConfirmationResult } from "@/lib/firebase";
import { sendWhatsAppOtp, claimSurvey, loginByPhone, fetchMySurveys, fetchLinkedInProfile, type MySurvey, type LinkedInProfile } from "@/api/client";
import {
  useCreateSurvey,
  useGenerateQuestions,
  useUpdateQuestions,
  type CreateSurveyResponse,
  type GenerateQuestionsResponse,
} from "@/api/client";
import { uploadAudioBlob } from "@/api/upload";
import { toast } from "@/components/ui/sonner";
import { useVisualViewport } from "@/hooks/useVisualViewport";
import { getDeviceAuth, saveDeviceAuth, clearDeviceAuth } from "@/lib/sessionStore";

type Stage = "home" | "player" | "profile" | "inbox" | "welcome" | "consent" | "creating" | "building" | "review" | "ready" | "phone" | "otp" | "linkedin-connect" | "linkedin-success" | "dashboard";

const CREATOR_SESSION_KEY = "parlo-creator-session";

/**
 * Maps creation-question index (0, 1) to the backend upload-URL key.
 * Question 0 = audience ("Who will I be talking to?")
 * Question 1 = gather ("What info do you need me to gather?")
 */
const QUESTION_INDEX_TO_KEY: Record<number, string> = {
  0: "audience",
  1: "gather",
};

export default function CreatorPage() {
  useVisualViewport();
  const navigate = useNavigate();
  const [initializing, setInitializing] = useState(true);
  const [stage, setStage] = useState<Stage>("welcome");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<VoiceAnswer[]>([]);
  const [screenKey, setScreenKey] = useState(0);
  const [preferredMode, setPreferredMode] = useState<"voice" | "text">("voice");
  const [direction, setDirection] = useState(1); // 1 = forward, -1 = back

  // Error state for building screen
  const [buildError, setBuildError] = useState(false);

  // Phone / OTP state
  const [phone, setPhone] = useState("");
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [confirmationResult, setConfirmationResult] = useState<ConfirmationResult | null>(null);
  const [devicePhone, setDevicePhone] = useState<string | null>(null);

  // Sidebar
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Home screen state
  const [mySurveys, setMySurveys] = useState<MySurvey[]>([]);
  const [apiKey, setApiKey] = useState<string | null>(null);

  // LinkedIn profile (for celebration screen)
  const [linkedInProfile, setLinkedInProfile] = useState<LinkedInProfile | null>(null);

  // Total new (unread) responses across all surveys
  const [totalNewCount, setTotalNewCount] = useState(0);

  // Check for returning device on mount — load home if possible
  // Also detect ?linkedin=connected from OAuth callback
  useEffect(() => {
    (async () => {
      try {
        const deviceAuth = await getDeviceAuth();
        if (deviceAuth) {
          setDevicePhone(deviceAuth.phone);
          setPhoneVerified(true);

          let key = deviceAuth.apiKey;

          // If no apiKey stored, try to fetch it by phone
          if (!key) {
            try {
              const loginRes = await loginByPhone(deviceAuth.phone);
              if (loginRes.apiKey) {
                key = loginRes.apiKey;
                saveDeviceAuth(deviceAuth.phone, key);
              }
            } catch {}
          }

          if (key) {
            setApiKey(key);
            try {
              const result = await fetchMySurveys(key);
              if (result.surveys.length > 0) {
                setMySurveys(result.surveys);
                // Pre-fetch LinkedIn profile before showing home
                try {
                  const profile = await fetchLinkedInProfile(deviceAuth.phone);
                  if (profile.connected) setLinkedInProfile(profile);
                } catch {}
                // Check if there are unread responses → show player
                const totalNew = result.surveys.reduce((sum, s) => sum + (s.newCount ?? 0), 0);
                setTotalNewCount(totalNew);
                if (totalNew > 0) {
                  setStage("player");
                } else {
                  setStage("home");
                }
              }
            } catch {}
          }
        }

        // Check if returning from LinkedIn OAuth
        const params = new URLSearchParams(window.location.search);
        if (params.get("linkedin") === "connected" && deviceAuth?.phone) {
          window.history.replaceState({}, "", window.location.pathname);
          // Restore survey state that was saved before the redirect
          try {
            const raw = sessionStorage.getItem(CREATOR_SESSION_KEY);
            if (raw) {
              sessionStorage.removeItem(CREATOR_SESSION_KEY);
              const session = JSON.parse(raw);
              if (session.surveyId) setSurveyId(session.surveyId);
              if (session.surveyCode) setSurveyCode(session.surveyCode);
              if (session.dashboardCode) setDashboardCode(session.dashboardCode);
              if (session.surveyTitle) setSurveyTitle(session.surveyTitle);
            }
          } catch {}
          try {
            const profile = await fetchLinkedInProfile(deviceAuth.phone);
            if (profile.connected) {
              setLinkedInProfile(profile);
              setStage("linkedin-success");
            }
          } catch {}
        }
      } catch {}
      setInitializing(false);
    })();
  }, []);

  // API-sourced state
  const [surveyId, setSurveyId] = useState<string | null>(null);
  const [surveyCode, setSurveyCode] = useState<string>("");
  const [dashboardCode, setDashboardCode] = useState<string>("");
  const [uploadUrls, setUploadUrls] = useState<
    CreateSurveyResponse["uploadUrls"] | null
  >(null);
  const [generatedQuestions, setGeneratedQuestions] = useState<
    { text: string; hint?: string; type?: "voice" | "photo" | "video" }[]
  >([]);
  const [surveyTitle, setSurveyTitle] = useState<string | null>(null);

  // Mutations
  const createSurvey = useCreateSurvey();
  const generateQuestions = useGenerateQuestions();
  const updateQuestions = useUpdateQuestions();

  // Track in-flight uploads so we don't block the UI
  const pendingUploads = useRef<Promise<boolean>[]>([]);

  const goForward = (nextStage: Stage) => {
    setDirection(1);
    setStage(nextStage);
    setScreenKey((k) => k + 1);
  };

  const handleStart = async () => {
    trackEvent("survey_creation_started");
    trackEvent("consent_accepted", { role: "creator" });

    try {
      const result = await createSurvey.mutateAsync();
      setSurveyId(result.id);
      setSurveyCode(result.code);
      setDashboardCode(result.dashboardCode);
      setUploadUrls(result.uploadUrls);

      goForward("creating");
    } catch (err) {
      captureException(err, { location: "CreatorPage.handleStart" });
      toast.error("Something went wrong. Please try again.");
    }
  };

  const handleAnswer = (answer: VoiceAnswer) => {
    // Upsert answer at current index
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

    // Remember the mode so the next question defaults to the same
    setPreferredMode(answer.textContent ? "text" : "voice");

    // Only upload audio blob if this is a voice answer (not text)
    if (answer.blob && !answer.textContent && uploadUrls) {
      const key = QUESTION_INDEX_TO_KEY[questionIndex] as keyof typeof uploadUrls;
      const url = uploadUrls[key];
      if (url) {
        const uploadPromise = uploadAudioBlob(url, answer.blob).catch(
          () => {
            toast.error(`Failed to upload recording. Please check your connection.`);
            return false as boolean;
          },
        );
        pendingUploads.current.push(uploadPromise);
      }
    }

    const nextIndex = questionIndex + 1;
    if (nextIndex >= CREATION_QUESTIONS.length) {
      trackEvent("survey_recording_completed", { questionCount: CREATION_QUESTIONS.length });
      forceReleaseSharedStream();
      goForward("building");
    } else {
      setDirection(1);
      setQuestionIndex(nextIndex);
      setScreenKey((k) => k + 1);
    }
  };

  const handleBack = () => {
    if (stage === "creating" && questionIndex > 0) {
      setDirection(-1);
      setQuestionIndex(questionIndex - 1);
      setScreenKey((k) => k + 1);
    }
  };

  const handleGenerate = useCallback(async (): Promise<GenerateQuestionsResponse | undefined> => {
    if (!surveyId) {
      toast.error("Survey not found. Please start over.");
      return undefined;
    }

    // Wait for any pending audio uploads to finish before generating
    try {
      await Promise.all(pendingUploads.current);
    } catch {
      // Upload errors were already toasted individually
    }

    // Collect text answers (from type-instead escape hatch) to pass directly
    const textAnswers = answers
      .filter((a) => a.textContent)
      .map((a) => ({ questionId: a.questionId, text: a.textContent! }));

    try {
      const result = await generateQuestions.mutateAsync({
        surveyId,
        textAnswers: textAnswers.length > 0 ? textAnswers : undefined,
      });
      return result;
    } catch (err) {
      captureException(err, { location: "CreatorPage.generateQuestions" });
      toast.error("Failed to generate questions. Please try again.");
      return undefined;
    }
  }, [surveyId, generateQuestions, answers]);

  const handleBuildingDone = useCallback(
    (result?: unknown) => {
      // Check if BuildingAgentScreen passed an error
      const maybeError = result as { error?: unknown } | undefined;
      if (maybeError?.error) {
        toast.error("Failed to generate questions. Tap 'Retry' to try again.");
        setBuildError(true);
        return;
      }

      setBuildError(false);
      const typed = result as GenerateQuestionsResponse | undefined;
      if (typed?.questions?.length) {
        setGeneratedQuestions(
          typed.questions.map((q) => ({
            text: q.text,
            hint: q.hint,
            type: q.type ?? "voice",
          })),
        );
        if (typed.title) setSurveyTitle(typed.title);
      } else {
        // Fallback — API returned empty; let user know
        toast.error("Could not generate questions. Please try regenerating.");
        setGeneratedQuestions([
          { text: "What's the biggest challenge you face in your day-to-day work?", type: "voice" },
          { text: "How do you currently solve that problem?", type: "voice" },
          { text: "If you could wave a magic wand, what would the ideal solution look like?", type: "voice" },
        ]);
      }
      goForward("review");
    },
    [],
  );

  const handleReviewConfirm = (
    questions: { text: string; hint?: string; type?: "voice" | "photo" | "video" }[],
  ) => {
    trackEvent("survey_questions_generated", { questionCount: questions.length });
    setGeneratedQuestions(questions);

    // Persist edited questions to backend (optimistic — proceed regardless).
    // We round-trip the media type so the creator's edits don't silently
    // reset a photo/video question back to voice.
    if (surveyId) {
      updateQuestions.mutate(
        { surveyId, questions },
        { onError: () => toast.error("Failed to save question edits. Your link still works.") },
      );
    }

    // If returning device, skip phone/OTP — but still check LinkedIn
    if (devicePhone) {
      setPhone(devicePhone);
      setPhoneVerified(true);
      identifyUser(devicePhone, { role: "creator" });
      if (surveyId) {
        claimSurvey(surveyId, devicePhone).then((res) => {
          if (res.apiKey) {
            setApiKey(res.apiKey);
            saveDeviceAuth(devicePhone, res.apiKey);
          }
        }).catch(() => {});
      }
      proceedAfterAuth(devicePhone);
    } else {
      goForward("phone");
    }
  };

  /** Check LinkedIn status and go to ready or linkedin-connect. */
  const proceedAfterAuth = useCallback(async (phoneToCheck: string) => {
    try {
      const profile = await fetchLinkedInProfile(phoneToCheck);
      if (profile.connected) {
        goForward("ready");
        return;
      }
    } catch {}
    goForward("linkedin-connect");
  }, []);

  /** Save survey state to sessionStorage before LinkedIn OAuth redirect. */
  const saveCreatorSession = useCallback(() => {
    try {
      sessionStorage.setItem(CREATOR_SESSION_KEY, JSON.stringify({
        surveyId, surveyCode, dashboardCode, surveyTitle,
      }));
    } catch {}
  }, [surveyId, surveyCode, dashboardCode, surveyTitle]);

  /** Restore survey state from sessionStorage after LinkedIn OAuth return. */
  const restoreCreatorSession = useCallback(() => {
    try {
      const raw = sessionStorage.getItem(CREATOR_SESSION_KEY);
      if (!raw) return false;
      sessionStorage.removeItem(CREATOR_SESSION_KEY);
      const session = JSON.parse(raw);
      if (session.surveyId) setSurveyId(session.surveyId);
      if (session.surveyCode) setSurveyCode(session.surveyCode);
      if (session.dashboardCode) setDashboardCode(session.dashboardCode);
      if (session.surveyTitle) setSurveyTitle(session.surveyTitle);
      return true;
    } catch { return false; }
  }, []);

  const handleRegenerate = async () => {
    goForward("building");
  };

  const handleDashboard = () => {
    if (dashboardCode) {
      navigate(`/d/${dashboardCode}`);
    } else {
      goForward("dashboard");
    }
  };

  const handlePhone = async (value: string) => {
    setPhone(value);
    try {
      const result = await sendOtp(value, "recaptcha-container");
      setConfirmationResult(result);
      goForward("otp");
    } catch {
      // Firebase failed → fall back to WhatsApp
      toast("SMS failed, trying WhatsApp...");
      try {
        await sendWhatsAppOtp(value);
        setConfirmationResult(null);
        goForward("otp");
      } catch {
        toast.error("Couldn't send verification code. Please try again.");
      }
    }
  };

  const handleOtpVerified = async (verifiedPhone: string) => {
    setPhone(verifiedPhone);
    setPhoneVerified(true);
    setDevicePhone(verifiedPhone);
    identifyUser(verifiedPhone, { role: "creator" });
    trackEvent("creator_phone_verified", { surveyId });

    // Attach phone to the survey's creator record and get API key
    if (surveyId) {
      try {
        const res = await claimSurvey(surveyId, verifiedPhone);
        if (res.apiKey) {
          setApiKey(res.apiKey);
          saveDeviceAuth(verifiedPhone, res.apiKey);
        } else {
          saveDeviceAuth(verifiedPhone);
        }
      } catch {
        saveDeviceAuth(verifiedPhone);
      }
      await proceedAfterAuth(verifiedPhone);
    } else {
      // Standalone login — look up apiKey by phone and load surveys
      try {
        const loginRes = await loginByPhone(verifiedPhone);
        if (loginRes.apiKey) {
          setApiKey(loginRes.apiKey);
          saveDeviceAuth(verifiedPhone, loginRes.apiKey);
          const surveysRes = await fetchMySurveys(loginRes.apiKey);
          if (surveysRes.surveys.length > 0) {
            setMySurveys(surveysRes.surveys);
            goForward("home");
            return;
          }
        } else {
          saveDeviceAuth(verifiedPhone);
        }
      } catch {
        saveDeviceAuth(verifiedPhone);
      }
      goForward("welcome");
    }
  };

  const pageKey =
    stage === "home"
      ? "home"
      : stage === "player"
      ? "player"
      : stage === "profile"
      ? "profile"
      : stage === "inbox"
      ? "inbox"
      : stage === "welcome"
      ? "welcome"
      : stage === "consent"
      ? "consent"
      : stage === "building"
      ? "building"
      : stage === "review"
      ? "review"
      : stage === "ready"
      ? "ready"
      : stage === "phone"
      ? "phone"
      : stage === "otp"
      ? "otp"
      : stage === "linkedin-connect"
      ? "linkedin-connect"
      : stage === "linkedin-success"
      ? "linkedin-success"
      : stage === "dashboard"
      ? "dashboard"
      : `cq-${screenKey}`;

  // Existing answer for current question (for re-recording)
  const existingAnswer = stage === "creating"
    ? answers.find((a) => a.questionId === CREATION_QUESTIONS[questionIndex]?.id)
    : undefined;

  if (initializing) {
    return (
      <div
        className="w-full flex items-center justify-center overflow-hidden bg-background"
        style={{ height: "var(--vvh, 100svh)" }}
      >
        <div className="flex items-center gap-2 opacity-45">
          <div className="w-2 h-2 rounded-full bg-primary rec-blink" />
          <span className="text-xs font-display tracking-widest uppercase" style={{ color: "hsl(225 10% 55%)" }}>
            Parlo
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="w-full flex items-center justify-center overflow-hidden bg-background"
      style={{ height: "var(--vvh, 100svh)" }}
    >
      {stage !== "home" && stage !== "profile" && stage !== "inbox" && <MenuButton onClick={() => setSidebarOpen(true)} />}
      <CreatorSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        phone={phoneVerified ? (devicePhone || phone) : devicePhone}
        onLogout={() => {
          clearDeviceAuth();
          setDevicePhone(null);
          setPhone("");
          setPhoneVerified(false);
          setApiKey(null);
          setMySurveys([]);
          setStage("welcome");
          setScreenKey((k) => k + 1);
        }}
        onLogin={() => {
          goForward("phone");
        }}
        onLinkedInConnected={(profile) => {
          setLinkedInProfile(profile);
          setStage("linkedin-success");
          setScreenKey((k) => k + 1);
        }}
      />
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
            {stage === "player" && apiKey && (
              <ListeningPlayer
                apiKey={apiKey}
                onExit={() => {
                  setStage("home");
                  setScreenKey((k) => k + 1);
                }}
              />
            )}
            {stage === "home" && (
              <CreatorHome
                surveys={mySurveys}
                phone={devicePhone || phone}
                linkedInProfile={linkedInProfile}
                totalNewCount={totalNewCount}
                onCreateNew={handleStart}
                onOpenReels={() => {
                  setStage("player");
                  setScreenKey((k) => k + 1);
                }}
                onOpenSettings={() => {
                  setStage("profile");
                  setScreenKey((k) => k + 1);
                }}
                onInbox={() => {
                  setStage("inbox");
                  setScreenKey((k) => k + 1);
                }}
                onOpenSurvey={(survey) => {
                  if (survey.questionCount > 0) {
                    navigate(`/d/${survey.dashboardCode}`);
                  } else {
                    // Draft — resume creation flow
                    setSurveyId(survey.id);
                    setSurveyCode(survey.code);
                    setDashboardCode(survey.dashboardCode);
                    goForward("creating");
                  }
                }}
              />
            )}
            {stage === "profile" && (
              <ProfilePage
                phone={devicePhone || phone}
                linkedInProfile={linkedInProfile}
                totalNewCount={totalNewCount}
                onLogout={() => {
                  clearDeviceAuth();
                  setDevicePhone(null);
                  setPhone("");
                  setPhoneVerified(false);
                  setApiKey(null);
                  setMySurveys([]);
                  setStage("welcome");
                  setScreenKey((k) => k + 1);
                }}
                onLogin={() => goForward("phone")}
                onHome={() => {
                  setStage("home");
                  setScreenKey((k) => k + 1);
                }}
                onSearch={() => {
                  setStage("player");
                  setScreenKey((k) => k + 1);
                }}
                onCreateNew={handleStart}
                onInbox={() => {
                  setStage("inbox");
                  setScreenKey((k) => k + 1);
                }}
              />
            )}
            {stage === "inbox" && apiKey && (
              <InboxPage
                apiKey={apiKey}
                linkedInProfile={linkedInProfile}
                totalNewCount={totalNewCount}
                onHome={() => {
                  setStage("home");
                  setScreenKey((k) => k + 1);
                }}
                onReels={() => {
                  setStage("player");
                  setScreenKey((k) => k + 1);
                }}
                onCreateNew={handleStart}
                onProfile={() => {
                  setStage("profile");
                  setScreenKey((k) => k + 1);
                }}
                onOpenSurvey={() => {
                  setStage("home");
                  setScreenKey((k) => k + 1);
                }}
              />
            )}
            {stage === "welcome" && (
              <CreateLanding onCreateAgent={handleStart} />
            )}
            {stage === "creating" && (
              <CreationQuestionScreen
                question={CREATION_QUESTIONS[questionIndex]}
                questionIndex={questionIndex}
                totalQuestions={CREATION_QUESTIONS.length}
                isLast={questionIndex === CREATION_QUESTIONS.length - 1}
                existingAnswer={existingAnswer}
                onNext={handleAnswer}
                onBack={questionIndex > 0 ? handleBack : () => {
                  setDirection(-1);
                  setStage(apiKey ? "home" : "welcome");
                  setScreenKey((k) => k + 1);
                }}
                initialMode={preferredMode}
              />
            )}
            {stage === "building" && (
              buildError ? (
                <div className="flex flex-col items-center justify-center h-full px-6 gap-6" style={{ background: "hsl(225 25% 4%)" }}>
                  <div
                    className="w-20 h-20 rounded-full flex items-center justify-center"
                    style={{ background: "hsl(var(--destructive) / 0.15)" }}
                  >
                    <span className="text-3xl" style={{ color: "hsl(var(--destructive))" }}>!</span>
                  </div>
                  <h2 className="font-display text-2xl text-center" style={{ fontWeight: 800, color: "hsl(40 20% 95%)" }}>
                    Something went wrong
                  </h2>
                  <p className="text-muted-foreground text-sm text-center">
                    We couldn't generate your questions. Please try again.
                  </p>
                  <button
                    onClick={() => {
                      setBuildError(false);
                      // Re-trigger building by bumping the screen key
                      setScreenKey((k) => k + 1);
                    }}
                    className="px-8 py-3 rounded-xl bg-primary text-primary-foreground font-display font-semibold text-sm"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <BuildingAgentScreen
                  onGenerate={handleGenerate}
                  onDone={handleBuildingDone}
                />
              )
            )}
            {stage === "review" && (
              <ReviewQuestionsScreen
                questions={generatedQuestions}
                onConfirm={handleReviewConfirm}
                onRegenerate={handleRegenerate}
              />
            )}
            {stage === "ready" && (
              <AgentReadyScreen
                surveyCode={surveyCode}
                surveyTitle={surveyTitle}
                dashboardCode={dashboardCode}
                onDashboard={handleDashboard}
              />
            )}
            {stage === "phone" && (
              <PhoneScreen
                onNext={handlePhone}
                onBack={() => {
                  setDirection(-1);
                  setStage(surveyId ? "review" : "welcome");
                  setScreenKey((k) => k + 1);
                }}
                initialValue={phone}
              />
            )}
            {stage === "otp" && (
              <OtpScreen
                phone={phone}
                confirmationResult={confirmationResult}
                onNext={handleOtpVerified}
                onBack={() => { setDirection(-1); setStage("phone"); setScreenKey((k) => k + 1); }}
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
                      Connect your LinkedIn
                    </h1>
                    <p
                      className="text-sm leading-relaxed font-light"
                      style={{ color: "hsl(225 10% 50%)" }}
                    >
                      We use LinkedIn to verify your identity and pull in your name and photo. It takes 5 seconds.
                    </p>
                  </div>
                </motion.div>

                <motion.button
                  onClick={() => {
                    saveCreatorSession();
                    const apiBase = import.meta.env.VITE_API_URL || "/api";
                    const p = devicePhone || phone;
                    window.location.href = `${apiBase}/auth/linkedin/start?phone=${encodeURIComponent(p)}`;
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
                  {/* Checkmark ring */}
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
                        <img
                          src={linkedInProfile.photoUrl}
                          alt={linkedInProfile.name ?? ""}
                          className="w-24 h-24 rounded-full object-cover"
                        />
                      ) : (
                        <div
                          className="w-24 h-24 rounded-full flex items-center justify-center font-display text-3xl font-bold"
                          style={{ background: "#0A66C2", color: "#fff" }}
                        >
                          {(linkedInProfile.name ?? "?").charAt(0)}
                        </div>
                      )}
                    </div>
                    {/* LinkedIn badge */}
                    <motion.div
                      className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full flex items-center justify-center"
                      style={{ background: "#0A66C2", border: "3px solid hsl(210 60% 8%)" }}
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.5, type: "spring", stiffness: 400, damping: 15 }}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff">
                        <path d="M20 6L9 17l-5-5" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                      </svg>
                    </motion.div>
                  </motion.div>

                  <motion.div
                    className="text-center space-y-2"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.35, duration: 0.4 }}
                  >
                    <h1
                      className="font-display text-2xl leading-tight"
                      style={{ fontWeight: 800, color: "hsl(40 20% 95%)" }}
                    >
                      You're connected!
                    </h1>
                    <p
                      className="text-lg font-display font-semibold"
                      style={{ color: "hsl(210 60% 70%)" }}
                    >
                      {linkedInProfile.name}
                    </p>
                    {linkedInProfile.email && (
                      <p className="text-sm" style={{ color: "hsl(225 10% 45%)" }}>
                        {linkedInProfile.email}
                      </p>
                    )}
                  </motion.div>
                </motion.div>

                <motion.button
                  onClick={() => {
                    if (mySurveys.length > 0) {
                      goForward("home");
                    } else {
                      goForward("welcome");
                    }
                  }}
                  className="w-full py-5 rounded-2xl font-display text-lg tracking-wide"
                  style={{
                    fontWeight: 700,
                    background: "#0A66C2",
                    color: "#fff",
                  }}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6, duration: 0.4 }}
                  whileTap={{ scale: 0.96, transition: { duration: 0.07 } }}
                >
                  Continue
                </motion.button>
              </div>
            )}
            {stage === "dashboard" && (
              <div className="flex items-center justify-center h-full">
                <p className="text-sm" style={{ color: "hsl(225 10% 45%)" }}>
                  Redirecting to dashboard...
                </p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
      <div id="recaptcha-container" style={{ position: "fixed", bottom: 0, right: 0, opacity: 0, pointerEvents: "none" }} />
    </div>
  );
}
