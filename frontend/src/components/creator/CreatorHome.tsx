import { motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import type { MySurvey, LinkedInProfile } from "@/api/client";
import { fadeUp, press, transitionLarge } from "@/lib/animations";
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

// Staggered fade-up — each card follows the previous by one stagger step
const cardVariants = {
  initial: { opacity: 0, y: 12 },
  animate: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { ...transitionLarge, delay: 0.04 + i * 0.04 },
  }),
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

const cardClass =
  "w-full block text-left rounded-m bg-card p-m mb-s transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring";

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
      className={cardClass}
      whileTap={press}
    >
      <div className="flex items-start justify-between gap-s">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-xs">
            <p className="text-m font-medium text-foreground truncate">
              {survey.title || "Untitled Survey"}
            </p>
            {/* Response count badge */}
            {hasResponses && (
              <span className="shrink-0 inline-flex items-center justify-center min-w-[20px] h-5 rounded-full px-xxs bg-badge text-badge-foreground font-data text-xxs font-medium">
                {survey.responseCount}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-xxs">
            {survey.questionCount} question{survey.questionCount !== 1 ? "s" : ""}
            {" · "}
            {survey.responseCount} response{survey.responseCount !== 1 ? "s" : ""}
            {" · "}
            {formatDate(survey.createdAt)}
          </p>
        </div>
        <ChevronRight size={16} className="shrink-0 mt-xxs text-neutral-6" aria-hidden />
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
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <div className="shrink-0 pt-xxl pb-l px-l">
        <div className="flex items-center justify-center mb-l">
          <span className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">
            Parlo
          </span>
        </div>

        <motion.div variants={fadeUp} initial="initial" animate="animate">
          {/* Greeting with LinkedIn name or phone */}
          <div className="flex items-center gap-s">
            {profile?.connected && profile.photoUrl ? (
              <img
                src={profile.photoUrl}
                alt={profile.name ?? ""}
                className="w-9 h-9 rounded-full object-cover shrink-0"
              />
            ) : null}
            <div>
              <h1 className="font-brand text-l sm:text-xl font-heavy text-foreground">
                {displayName ? `Hey, ${displayName}` : "Your surveys"}
              </h1>
              {displayName && (
                <p className="text-xs text-muted-foreground mt-xxs">
                  {totalResponses} total response{totalResponses !== 1 ? "s" : ""} across {completed.length} survey{completed.length !== 1 ? "s" : ""}
                </p>
              )}
            </div>
          </div>
        </motion.div>
      </div>

      {/* Survey list — pb-20 clears the 72px tab bar */}
      <div className="flex-1 min-h-0 overflow-y-auto px-l pb-20">
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
          <motion.p
            className="px-xxs mt-xs text-xs text-muted-foreground"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ ...transitionLarge, delay: 0.2 }}
          >
            {totalResponses === 0
              ? "Share your survey link on WhatsApp to start getting responses"
              : `You have ${totalResponses} response${totalResponses !== 1 ? "s" : ""} — share again to keep the momentum going`}
          </motion.p>
        )}

        {drafts.length > 0 && (
          <>
            <motion.p
              className="font-brand text-s font-medium tracking-xl uppercase text-muted-foreground mt-l mb-xs px-xxs"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ ...transitionLarge, delay: 0.2 }}
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
                className={cardClass}
                whileTap={press}
              >
                <div className="flex items-center justify-between gap-s">
                  <div className="min-w-0">
                    <p className="text-s font-medium text-muted-foreground">
                      Draft · {formatDate(survey.createdAt)}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-color-1 shrink-0">
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
