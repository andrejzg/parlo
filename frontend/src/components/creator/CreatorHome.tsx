import { motion } from "framer-motion";
import type { MySurvey, LinkedInProfile } from "@/api/client";
import BottomTabBar from "./BottomTabBar";

interface CreatorHomeProps {
  surveys: MySurvey[];
  phone: string;
  linkedInProfile?: LinkedInProfile | null;
  totalNewCount: number;
  onCreateNew: () => void;
  onOpenSurvey: (survey: MySurvey) => void;
  onOpenReels: () => void;
  onOpenSettings: () => void;
  onInbox: () => void;
}

// Spring-based stagger — each card overshoots slightly and settles
const cardVariants = {
  initial: { opacity: 0, y: 24, scale: 0.97 },
  animate: (i: number) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      delay: 0.12 + i * 0.08,
      type: "spring" as const,
      stiffness: 260,
      damping: 20,
    },
  }),
};

const headerVariants = {
  initial: { opacity: 0, y: 16 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as number[] },
  },
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatTimeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function SurveyCard({
  survey,
  index,
  onTap,
}: {
  survey: MySurvey;
  index: number;
  onTap: () => void;
}) {
  const hasResponses = survey.responseCount > 0;

  return (
    <motion.button
      type="button"
      onClick={onTap}
      custom={index}
      variants={cardVariants}
      initial="initial"
      animate="animate"
      className="w-full block text-left rounded-2xl px-5 py-4 mb-3"
      style={{
        background: "hsl(225 15% 10%)",
        border: "1px solid hsl(225 15% 14%)",
      }}
      whileTap={{ scale: 0.97, transition: { type: "spring", stiffness: 400, damping: 25 } }}
      whileHover={{ borderColor: "hsl(225 15% 22%)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <p
              className="font-display text-base font-semibold truncate"
              style={{ color: "hsl(40 20% 95%)" }}
            >
              {survey.title || "Untitled Survey"}
            </p>
            {/* Response count badge */}
            {hasResponses && (
              <span
                className="shrink-0 inline-flex items-center justify-center min-w-[20px] h-5 rounded-full px-1.5 text-[10px] font-display font-bold"
                style={{
                  background: "hsl(var(--primary) / 0.15)",
                  color: "hsl(var(--primary))",
                }}
              >
                {survey.responseCount}
              </span>
            )}
          </div>
          <p className="text-xs mt-1.5" style={{ color: "hsl(225 10% 42%)" }}>
            {survey.questionCount} question{survey.questionCount !== 1 ? "s" : ""}
            {" · "}
            {survey.responseCount} response{survey.responseCount !== 1 ? "s" : ""}
            {" · "}
            {formatDate(survey.createdAt)}
          </p>
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="hsl(225 10% 30%)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 mt-1.5"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </div>
    </motion.button>
  );
}

export default function CreatorHome({
  surveys,
  phone,
  linkedInProfile,
  totalNewCount,
  onCreateNew,
  onOpenSurvey,
  onOpenReels,
  onOpenSettings,
  onInbox,
}: CreatorHomeProps) {
  const completed = surveys.filter((s) => s.questionCount > 0);
  const drafts = surveys.filter((s) => s.questionCount === 0);
  const totalResponses = surveys.reduce((sum, s) => sum + s.responseCount, 0);

  const profile = linkedInProfile;
  const displayName = profile?.connected && profile.name
    ? profile.name.split(" ")[0]
    : null;

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ background: "hsl(225 25% 4%)" }}
    >
      {/* Header */}
      <div className="shrink-0 pt-14 pb-5 px-6">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.45 }}
          transition={{ duration: 0.4 }}
          className="flex items-center justify-center gap-2 mb-6"
        >
          <div className="w-2 h-2 rounded-full bg-primary rec-blink" />
          <span
            className="text-xs font-display tracking-widest uppercase"
            style={{ color: "hsl(225 10% 55%)" }}
          >
            Parlo
          </span>
        </motion.div>

        <motion.div variants={headerVariants} initial="initial" animate="animate">
          {/* Greeting with LinkedIn name or phone */}
          <div className="flex items-center gap-3 mb-1">
            {profile?.connected && profile.photoUrl ? (
              <img
                src={profile.photoUrl}
                alt={profile.name ?? ""}
                className="w-9 h-9 rounded-full object-cover shrink-0"
              />
            ) : null}
            <div>
              <h1
                className="font-display leading-tight"
                style={{
                  fontSize: displayName ? "clamp(1.4rem, 6vw, 1.8rem)" : "clamp(1.6rem, 7vw, 2.2rem)",
                  fontWeight: 800,
                  color: "hsl(40 20% 95%)",
                }}
              >
                {displayName ? `Hey, ${displayName}` : "Your surveys"}
              </h1>
              {displayName && (
                <p className="text-xs mt-0.5" style={{ color: "hsl(225 10% 42%)" }}>
                  {totalResponses} total response{totalResponses !== 1 ? "s" : ""} across {completed.length} survey{completed.length !== 1 ? "s" : ""}
                </p>
              )}
            </div>
          </div>
        </motion.div>
      </div>

      {/* Survey list */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-20">
        {completed.map((survey, i) => (
          <SurveyCard
            key={survey.id}
            survey={survey}
            index={i}
            onTap={() => onOpenSurvey(survey)}
          />
        ))}

        {/* Empty space coaching tip */}
        {completed.length > 0 && completed.length < 3 && (
          <motion.div
            className="flex items-center gap-3 rounded-xl px-4 py-3 mt-2"
            style={{ background: "hsl(225 15% 7%)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.5 }}
          >
            <span className="text-xs" style={{ color: "hsl(225 10% 35%)" }}>
              {totalResponses === 0
                ? "Share your survey link on WhatsApp to start getting responses"
                : `You have ${totalResponses} response${totalResponses !== 1 ? "s" : ""} — share again to keep the momentum going`}
            </span>
          </motion.div>
        )}

        {drafts.length > 0 && (
          <>
            <motion.p
              className="text-xs font-display uppercase tracking-widest mt-5 mb-2 px-1"
              style={{ color: "hsl(225 10% 30%)" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.4 }}
            >
              Drafts
            </motion.p>
            {drafts.map((survey, i) => (
              <motion.button
                key={survey.id}
                type="button"
                onClick={() => onOpenSurvey(survey)}
                custom={completed.length + i}
                variants={cardVariants}
                initial="initial"
                animate="animate"
                className="w-full block text-left rounded-2xl px-5 py-4 mb-3"
                style={{
                  background: "hsl(225 15% 8%)",
                  border: "1px dashed hsl(225 15% 16%)",
                }}
                whileTap={{ scale: 0.97, transition: { type: "spring", stiffness: 400, damping: 25 } }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p
                      className="font-display text-sm font-semibold"
                      style={{ color: "hsl(225 10% 45%)" }}
                    >
                      Draft · {formatDate(survey.createdAt)}
                    </p>
                  </div>
                  <span
                    className="text-xs font-display font-semibold shrink-0"
                    style={{ color: "hsl(var(--primary) / 0.7)" }}
                  >
                    Continue
                  </span>
                </div>
              </motion.button>
            ))}
          </>
        )}
      </div>

      <BottomTabBar
        activeTab="home"
        totalNewCount={totalNewCount}
        linkedInProfile={linkedInProfile}
        onHome={() => {}}
        onSearch={onOpenReels}
        onCreateNew={onCreateNew}
        onContent={onInbox}
        onProfile={onOpenSettings}
      />
    </div>
  );
}
