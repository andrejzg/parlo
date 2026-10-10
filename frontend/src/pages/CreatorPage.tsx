import { useState, useCallback, useRef, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import CreateLanding from "@/components/creator/CreateLanding";
import ConsentScreen from "@/components/ConsentScreen";
import CreationQuestionScreen from "@/components/creator/CreationQuestionScreen";
import BriefScreen, { type BriefResult } from "@/components/creator/BriefScreen";
import CheckpointScreen from "@/components/creator/CheckpointScreen";
import BuildingAgentScreen from "@/components/creator/BuildingAgentScreen";
import ReviewQuestionsScreen from "@/components/creator/ReviewQuestionsScreen";
import IntroScreen, { type IntroResult } from "@/components/creator/IntroScreen";
import AgentReadyScreen from "@/components/creator/AgentReadyScreen";
import PhoneScreen from "@/components/participant/PhoneScreen";
import OtpScreen from "@/components/participant/OtpScreen";
import CreatorSidebar, { MenuButton } from "@/components/creator/CreatorSidebar";
import { VoiceAnswer } from "@/types/survey";
import { fadeUp, pageVariants, popup, stagger } from "@/lib/animations";
import { Check, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trackEvent, identifyUser, captureException } from "@/lib/posthog";
import { forceReleaseSharedStream } from "@/hooks/useVoiceRecorder";
import CreatorHome from "@/components/creator/CreatorHome";
import ProfilePage from "@/components/creator/ProfilePage";
import InboxPage from "@/components/creator/InboxPage";
import ListeningPlayer from "@/components/creator/player/ListeningPlayer";
import { sendOtp, type ConfirmationResult } from "@/lib/firebase";
import { sendWhatsAppOtp, claimSurvey, loginByPhone, fetchMySurveys, fetchLinkedInProfile, fetchIntroUploadUrl, saveIntro, type MySurvey, type LinkedInProfile } from "@/api/client";
import {
  useCreateSurvey,
  useGenerateQuestions,
  useUpdateQuestions,
  fetchClarifyingQuestion,
  type CreateSurveyResponse,
  type GenerateQuestionsResponse,
  type Clarification,
  type ClarifyingQuestion,
} from "@/api/client";
import { uploadAudioBlob } from "@/api/upload";
import { toast } from "@/components/ui/sonner";
import { useVisualViewport } from "@/hooks/useVisualViewport";
import { getDeviceAuth, saveDeviceAuth, clearDeviceAuth } from "@/lib/sessionStore";
import { isClarifyCheckpoint, MAX_CLARIFICATIONS } from "@/lib/briefChecklist";

/**
 * Creation flow:
 *   welcome → brief (one screen, 5-item checklist ticks live via TypeSafe Jev)
 *           → clarify ×N (one Cerebras follow-up per screen)
 *           → checkpoint after answer 2, 5, 10, 15… ("Create agent" / "Ask me more")
 *           → building → review → intro (voice hello, skippable)
 *           → phone/otp → linkedin → ready
 */
type Stage = "home" | "player" | "profile" | "inbox" | "welcome" | "consent" | "brief" | "clarify" | "checkpoint" | "building" | "review" | "intro" | "ready" | "phone" | "otp" | "linkedin-connect" | "linkedin-success" | "dashboard";

const CREATOR_SESSION_KEY = "parlo-creator-session";

export default function CreatorPage() {
  useVisualViewport();
  const navigate = useNavigate();
  const [initializing, setInitializing] = useState(true);
  const [stage, setStage] = useState<Stage>("welcome");
  const [screenKey, setScreenKey] = useState(0);
  const [preferredMode, setPreferredMode] = useState<"voice" | "text">("voice");
  const [direction, setDirection] = useState(1); // 1 = forward, -1 = back

  // Agent brief flow state
  const [brief, setBrief] = useState("");
  const [briefMode, setBriefMode] = useState<"voice" | "text">("voice");
  const [clarifications, setClarifications] = useState<Clarification[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<ClarifyingQuestion | null>(null);
  const [clarifyAnswerDraft, setClarifyAnswerDraft] = useState<string | null>(null);
  const [nextLoading, setNextLoading] = useState(false);

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
      resetBriefFlow();

      goForward("brief");
    } catch (err) {
      captureException(err, { location: "CreatorPage.handleStart" });
      toast.error("Something went wrong. Please try again.");
    }
  };

  const resetBriefFlow = () => {
    setBrief("");
    setClarifications([]);
    setCurrentQuestion(null);
    setClarifyAnswerDraft(null);
    setNextLoading(false);
  };

  /**
   * Fetch the next Cerebras follow-up for the given history and show it.
   * If the model can't produce one, we don't block the creator: go build.
   */
  const fetchNextQuestion = useCallback(
    async (briefText: string, history: Clarification[]) => {
      if (!surveyId) return;
      setNextLoading(true);
      try {
        const q = await fetchClarifyingQuestion(surveyId, briefText, history);
        setCurrentQuestion(q);
        setClarifyAnswerDraft(null);
        trackEvent("clarify_question_shown", { index: q.index });
        goForward("clarify");
      } catch (err) {
        captureException(err, { location: "CreatorPage.fetchNextQuestion" });
        toast("Couldn't think of a follow-up — building your agent with what I have.");
        forceReleaseSharedStream();
        goForward("building");
      } finally {
        setNextLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [surveyId],
  );

  /** Step 1 done: the brief is in. Keep the recording, ask the first follow-up. */
  const handleBriefContinue = async (result: BriefResult) => {
    const text = result.transcript.trim();
    if (!text) {
      toast.error("I didn't catch anything — try again?");
      setScreenKey((k) => k + 1);
      return;
    }
    setBrief(text);
    setBriefMode(result.mode);
    setPreferredMode(result.mode);
    trackEvent("brief_submitted", {
      mode: result.mode,
      source: result.source,
      chars: text.length,
      durationMs: result.durationMs,
    });

    // Keep the raw recording for the future "proper agent" work (voice persona
    // etc). Fire and forget; the transcript is what the pipeline needs today.
    if (result.blob && uploadUrls?.brief) {
      const uploadPromise = uploadAudioBlob(uploadUrls.brief, result.blob).catch((err) => {
        captureException(err, { location: "CreatorPage.uploadBrief" });
        return false as boolean;
      });
      pendingUploads.current.push(uploadPromise);
    }

    await fetchNextQuestion(text, []);
  };

  /** A follow-up was answered. Checkpoint, cap, or fetch the next one. */
  const handleClarifyAnswer = async (answer: VoiceAnswer) => {
    if (!currentQuestion) return;
    const text = (answer.textContent ?? answer.transcript ?? "").trim();
    setPreferredMode(answer.textContent ? "text" : "voice");

    if (!text) {
      toast.error("I didn't catch that — could you say it again?");
      setClarifyAnswerDraft(null);
      setScreenKey((k) => k + 1);
      return;
    }

    const history = [...clarifications, { question: currentQuestion.question, answer: text }];
    setClarifications(history);
    const n = history.length;
    trackEvent("clarify_question_answered", { index: n, mode: answer.textContent ? "text" : "voice", chars: text.length });

    if (n >= MAX_CLARIFICATIONS) {
      forceReleaseSharedStream();
      goForward("checkpoint");
      return;
    }
    if (isClarifyCheckpoint(n)) {
      goForward("checkpoint");
      return;
    }
    await fetchNextQuestion(brief, history);
  };

  /** Back from a follow-up: re-open the previous one (or the brief) with its answer editable. */
  const handleClarifyBack = () => {
    setDirection(-1);
    if (clarifications.length === 0) {
      setBriefMode("text");
      setStage("brief");
      setScreenKey((k) => k + 1);
      return;
    }
    const prev = clarifications[clarifications.length - 1];
    setClarifications(clarifications.slice(0, -1));
    setCurrentQuestion({ question: prev.question, hint: null, index: clarifications.length });
    setClarifyAnswerDraft(prev.answer);
    setStage("clarify");
    setScreenKey((k) => k + 1);
  };

  const handleCheckpointCreate = () => {
    trackEvent("clarify_checkpoint", { choice: "create", answered: clarifications.length });
    forceReleaseSharedStream();
    goForward("building");
  };

  const handleCheckpointContinue = async () => {
    trackEvent("clarify_checkpoint", { choice: "continue", answered: clarifications.length });
    await fetchNextQuestion(brief, clarifications);
  };

  const handleGenerate = useCallback(async (): Promise<GenerateQuestionsResponse | undefined> => {
    if (!surveyId) {
      toast.error("Survey not found. Please start over.");
      return undefined;
    }
    if (!brief.trim()) {
      toast.error("Your brief is empty. Please start over.");
      return undefined;
    }

    // Wait for any pending audio uploads to finish before generating
    try {
      await Promise.all(pendingUploads.current);
    } catch {
      // Upload errors were already toasted individually
    }

    try {
      const result = await generateQuestions.mutateAsync({
        surveyId,
        brief,
        clarifications,
      });
      return result;
    } catch (err) {
      captureException(err, { location: "CreatorPage.generateQuestions" });
      toast.error("Failed to generate questions. Please try again.");
      return undefined;
    }
  }, [surveyId, generateQuestions, brief, clarifications]);

  const handleBuildingDone = useCallback(
    (result?: unknown) => {
      // Check if BuildingAgentScreen passed an error
      const maybeError = result as { error?: unknown } | undefined;
      if (maybeError?.error) {
        captureException(maybeError.error, { location: "CreatorPage.handleBuildingDone" });
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

    goForward("intro");
  };

  /**
   * The creator recorded (or skipped) their voice hello. Upload it in the
   * background — the share link works either way — then move on to auth.
   */
  const handleIntroContinue = (intro: IntroResult | null) => {
    if (intro && surveyId) {
      const id = surveyId;
      fetchIntroUploadUrl(id)
        .then((url) => uploadAudioBlob(url, intro.blob))
        .then(() => saveIntro(id, intro.durationMs))
        .catch((err) => {
          captureException(err, { location: "CreatorPage.uploadIntro" });
          toast.error("Couldn't save your hello. Your link still works.");
        });
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
    } catch (smsErr) {
      // Firebase failed → fall back to WhatsApp
      captureException(smsErr, { location: "CreatorPage.handlePhone.sendOtp" });
      toast("SMS failed, trying WhatsApp...");
      try {
        await sendWhatsAppOtp(value);
        setConfirmationResult(null);
        goForward("otp");
      } catch (waErr) {
        captureException(waErr, { location: "CreatorPage.handlePhone.sendWhatsAppOtp" });
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
      : stage === "brief"
      ? `brief-${screenKey}`
      : stage === "checkpoint"
      ? `checkpoint-${clarifications.length}`
      : stage === "building"
      ? "building"
      : stage === "review"
      ? "review"
      : stage === "intro"
      ? "intro"
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

  // When stepping back to a follow-up, re-open it with the previous answer typed in.
  const existingAnswer: VoiceAnswer | undefined =
    stage === "clarify" && currentQuestion && clarifyAnswerDraft
      ? { questionId: `clarify-${currentQuestion.index}`, durationMs: 0, textContent: clarifyAnswerDraft }
      : undefined;

  if (initializing) {
    return (
      <div
        className="w-full flex items-center justify-center overflow-hidden bg-background"
        style={{ height: "var(--vvh, 100svh)" }}
      >
        <span className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">Parlo</span>
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
                    // Draft — resume creation flow from the brief
                    setSurveyId(survey.id);
                    setSurveyCode(survey.code);
                    setDashboardCode(survey.dashboardCode);
                    setUploadUrls(null);
                    resetBriefFlow();
                    goForward("brief");
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
            {stage === "brief" && surveyId && (
              <BriefScreen
                surveyId={surveyId}
                initialMode={brief ? briefMode : preferredMode}
                initialTranscript={brief}
                busy={nextLoading}
                onContinue={handleBriefContinue}
                onBack={() => {
                  setDirection(-1);
                  forceReleaseSharedStream();
                  setStage(apiKey ? "home" : "welcome");
                  setScreenKey((k) => k + 1);
                }}
              />
            )}
            {stage === "clarify" && currentQuestion && (
              <CreationQuestionScreen
                question={{
                  id: `clarify-${currentQuestion.index}`,
                  text: currentQuestion.question,
                  subtext: currentQuestion.hint,
                }}
                questionIndex={currentQuestion.index - 1}
                totalQuestions={currentQuestion.index}
                isLast={false}
                progressLabel={`Step 2 · Follow-up ${currentQuestion.index}`}
                ctaLabel="Continue"
                transcriptSurveyId={surveyId ?? undefined}
                busy={nextLoading}
                existingAnswer={existingAnswer}
                onNext={handleClarifyAnswer}
                onBack={handleClarifyBack}
                initialMode={preferredMode}
              />
            )}
            {stage === "checkpoint" && (
              <CheckpointScreen
                answeredCount={clarifications.length}
                canContinue={clarifications.length < MAX_CLARIFICATIONS}
                busy={nextLoading}
                onCreate={handleCheckpointCreate}
                onContinue={handleCheckpointContinue}
              />
            )}
            {stage === "building" && (
              buildError ? (
                <div className="flex flex-col items-center justify-center h-full px-l gap-l bg-background text-center">
                  <div className="w-20 h-20 rounded-full flex items-center justify-center bg-error-transparent text-error">
                    <CircleAlert size={32} aria-hidden />
                  </div>
                  <h2 className="font-brand text-l sm:text-xl font-heavy text-foreground">
                    Something went wrong
                  </h2>
                  <p className="text-s text-muted-foreground">
                    We couldn't generate your questions. Please try again.
                  </p>
                  <Button
                    onClick={() => {
                      setBuildError(false);
                      // Re-trigger building by bumping the screen key
                      setScreenKey((k) => k + 1);
                    }}
                  >
                    Retry
                  </Button>
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
            {stage === "intro" && (
              <IntroScreen
                onContinue={handleIntroContinue}
                onBack={() => {
                  setDirection(-1);
                  setStage("review");
                  setScreenKey((k) => k + 1);
                }}
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
                  setStage(surveyId ? "intro" : "welcome");
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
              <motion.div
                className="flex flex-col items-center justify-between h-full px-l py-xxl bg-background"
                variants={stagger}
                initial="initial"
                animate="animate"
              >
                <div />

                <motion.div className="flex flex-col items-center gap-l" variants={fadeUp}>
                  {/* LinkedIn's own glyph stays inline (third-party artwork); colour comes from the text utilities. */}
                  <div className="w-20 h-20 rounded-full flex items-center justify-center bg-linkedin text-neutral-1 dark:text-neutral-10">
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                    </svg>
                  </div>

                  <div className="flex flex-col gap-s text-center">
                    <h1 className="font-brand text-l sm:text-xl font-heavy text-foreground">
                      Connect your LinkedIn
                    </h1>
                    <p className="text-s text-muted-foreground">
                      We use LinkedIn to verify your identity and pull in your name and photo. It takes 5 seconds.
                    </p>
                  </div>
                </motion.div>

                <motion.div className="w-full" variants={fadeUp}>
                  <Button
                    size="lg"
                    className="w-full bg-linkedin text-neutral-1 dark:text-neutral-10"
                    onClick={() => {
                      saveCreatorSession();
                      const apiBase = import.meta.env.VITE_API_URL || "/api";
                      const p = devicePhone || phone;
                      window.location.href = `${apiBase}/auth/linkedin/start?phone=${encodeURIComponent(p)}`;
                    }}
                  >
                    Continue with LinkedIn
                  </Button>
                </motion.div>
              </motion.div>
            )}
            {stage === "linkedin-success" && linkedInProfile && (
              <motion.div
                className="flex flex-col items-center justify-between h-full px-l py-xxl bg-background"
                variants={stagger}
                initial="initial"
                animate="animate"
              >
                <div />

                <div className="flex flex-col items-center gap-l">
                  {/* Avatar ring */}
                  <motion.div className="relative" variants={popup}>
                    <div className="w-28 h-28 rounded-full flex items-center justify-center bg-muted">
                      {linkedInProfile.photoUrl ? (
                        <img
                          src={linkedInProfile.photoUrl}
                          alt={linkedInProfile.name ?? ""}
                          className="w-24 h-24 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-24 h-24 rounded-full flex items-center justify-center bg-linkedin font-brand text-xl font-medium text-neutral-1 dark:text-neutral-10">
                          {(linkedInProfile.name ?? "?").charAt(0)}
                        </div>
                      )}
                    </div>
                    {/* LinkedIn badge — its ring is a shadow in the page background (no native stroke) */}
                    <motion.div
                      className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full flex items-center justify-center bg-linkedin text-neutral-1 dark:text-neutral-10 shadow-[0_0_0_3px_var(--background)]"
                      variants={popup}
                    >
                      <Check size={16} aria-hidden />
                    </motion.div>
                  </motion.div>

                  <motion.div className="flex flex-col gap-xs text-center" variants={fadeUp}>
                    <h1 className="font-brand text-l sm:text-xl font-heavy text-foreground">
                      You're connected!
                    </h1>
                    <p className="text-m font-medium text-foreground">
                      {linkedInProfile.name}
                    </p>
                    {linkedInProfile.email && (
                      <p className="text-s text-muted-foreground">
                        {linkedInProfile.email}
                      </p>
                    )}
                  </motion.div>
                </div>

                <motion.div className="w-full" variants={fadeUp}>
                  <Button
                    size="lg"
                    className="w-full"
                    onClick={() => {
                      if (mySurveys.length > 0) {
                        goForward("home");
                      } else {
                        goForward("welcome");
                      }
                    }}
                  >
                    Continue
                  </Button>
                </motion.div>
              </motion.div>
            )}
            {stage === "dashboard" && (
              <div className="flex items-center justify-center h-full">
                <p className="text-s text-muted-foreground">
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
