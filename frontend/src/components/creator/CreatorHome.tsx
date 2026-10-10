import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { MySurvey, LinkedInProfile, ParloFace } from "@/api/client";
import { fadeUp, press, transitionLarge } from "@/lib/animations";
import { describeParlo, formatListTime, initialsFor, sortParlos } from "@/lib/parloRow";
import BottomTabBar from "./BottomTabBar";

interface CreatorHomeProps {
  surveys: MySurvey[];
  phone: string;
  linkedInProfile?: LinkedInProfile | null;
  onCreateNew: () => void;
  onOpenSurvey: (survey: MySurvey) => void;
  onOpenSettings: () => void;
  onInbox: () => void;
}

// Staggered fade-up — each row follows the previous by one stagger step
const rowVariants = {
  initial: { opacity: 0, y: 12 },
  animate: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { ...transitionLarge, delay: 0.04 + i * 0.04 },
  }),
};

// ── Avatar cluster ─────────────────────────────────────────────────────
// A 44 px tile, like a group icon in a chat list. One face fills it, two sit
// on a diagonal, three make a triangle. Sizes and offsets are the tile's
// geometry (structural); the ring between faces is the row's own surface.

const TILE = 44;
const CLUSTER: Record<number, { size: number; at: [number, number][] }> = {
  1: { size: TILE, at: [[0, 0]] },
  2: { size: 28, at: [[0, 0], [16, 16]] },
  3: { size: 24, at: [[0, 0], [20, 0], [10, 20]] },
};

function initialsStep(size: number) {
  return size >= TILE ? "text-s" : size >= 28 ? "text-xs" : "text-xxs";
}

function Face({ face, size }: { face: ParloFace; size: number }) {
  const [broken, setBroken] = useState(false);
  if (face.photoUrl && !broken) {
    return (
      <img
        src={face.photoUrl}
        alt=""
        onError={() => setBroken(true)}
        className="rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className={`rounded-full flex items-center justify-center bg-muted font-data ${initialsStep(size)} font-medium text-neutral-8`}
      style={{ width: size, height: size }}
    >
      {initialsFor(face.name)}
    </span>
  );
}

function GroupAvatar({ faces, title }: { faces: ParloFace[]; title: string | null }) {
  const shown = faces.slice(0, 3);
  if (shown.length === 0) {
    return (
      <div
        className="rounded-full flex items-center justify-center shrink-0 bg-muted font-brand text-s font-medium text-neutral-8"
        style={{ width: TILE, height: TILE }}
        aria-hidden
      >
        {(title ?? "").trim().charAt(0).toUpperCase()}
      </div>
    );
  }
  const layout = CLUSTER[shown.length];
  return (
    <div className="relative shrink-0" style={{ width: TILE, height: TILE }} aria-hidden>
      {shown.map((face, i) => (
        <div
          key={face.userId}
          className={`absolute rounded-full ${shown.length > 1 ? "shadow-[0_0_0_2px_var(--card)]" : ""}`}
          style={{ left: layout.at[i][0], top: layout.at[i][1], width: layout.size, height: layout.size }}
        >
          <Face face={face} size={layout.size} />
        </div>
      ))}
    </div>
  );
}

// ── Row ────────────────────────────────────────────────────────────────

const rowClass =
  "w-full flex items-start gap-s rounded-m bg-card p-m text-left transition-colors hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring";

function ParloRow({ survey, index, onTap }: { survey: MySurvey; index: number; onTap: () => void }) {
  const row = describeParlo(survey);
  const title = survey.title || "Untitled parlo";
  const emphasised = row.unread || row.action !== null;

  return (
    <motion.button
      type="button"
      onClick={onTap}
      custom={index}
      variants={rowVariants}
      initial="initial"
      animate="animate"
      className={rowClass}
      whileTap={press}
      data-testid="parlo-row"
      data-action={row.action ?? undefined}
      data-unread={row.unread || undefined}
    >
      <GroupAvatar faces={survey.faces ?? []} title={survey.title} />

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-s">
          <p
            className={`min-w-0 line-clamp-2 text-m ${emphasised ? "font-medium" : "font-regular"} ${
              row.draft ? "text-muted-foreground" : "text-foreground"
            }`}
          >
            {title}
          </p>
          <span className="shrink-0 pt-xxs font-data text-xxs tabular-nums text-muted-foreground">
            {survey.role === "admin" || survey.role === "member" ? `${survey.role} · ` : null}
            <time dateTime={row.activityAt}>{formatListTime(row.activityAt)}</time>
          </span>
        </div>

        <div className="flex items-center justify-between gap-s mt-xxs">
          <p className="min-w-0 truncate text-xs text-muted-foreground">{row.preview}</p>
          {row.action ? (
            <span className="shrink-0 rounded-full bg-badge px-xs py-xxs text-xxs font-medium text-badge-foreground">
              {row.action === "approve" ? "Approve" : "Answer"}
            </span>
          ) : row.unread ? (
            <>
              <span className="shrink-0 w-2 h-2 rounded-full bg-color-1" aria-hidden />
              <span className="sr-only">New answers</span>
            </>
          ) : null}
        </div>
      </div>
    </motion.button>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────

export default function CreatorHome({
  surveys,
  linkedInProfile,
  onCreateNew,
  onOpenSurvey,
  onOpenSettings,
  onInbox,
}: CreatorHomeProps) {
  // One list, like a chat app: what needs you first, then newest activity, drafts last.
  const rows = useMemo(() => sortParlos(surveys), [surveys]);

  const profile = linkedInProfile;
  const displayName = profile?.connected && profile.name ? profile.name.split(" ")[0] : null;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <div className="shrink-0 pt-xxl pb-l px-l">
        <div className="flex items-center justify-center mb-l">
          <span className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">
            Parlo
          </span>
        </div>

        <motion.div variants={fadeUp} initial="initial" animate="animate" className="flex items-center gap-s">
          {profile?.connected && profile.photoUrl ? (
            <img
              src={profile.photoUrl}
              alt={profile.name ?? ""}
              className="w-9 h-9 rounded-full object-cover shrink-0"
            />
          ) : null}
          <h1 className="font-brand text-l sm:text-xl font-heavy text-foreground">
            {displayName ? `Hey, ${displayName}` : "Your parlos"}
          </h1>
        </motion.div>
      </div>

      {/* Parlo list — pb-20 clears the 72px tab bar */}
      <div className="flex-1 min-h-0 overflow-y-auto px-l pb-20">
        {rows.length === 0 ? (
          <p className="text-s text-muted-foreground">No parlos yet. Tap + to create one.</p>
        ) : (
          <div className="space-y-s">
            {rows.map((survey, i) => (
              <ParloRow key={survey.id} survey={survey} index={i} onTap={() => onOpenSurvey(survey)} />
            ))}
          </div>
        )}
      </div>

      <BottomTabBar
        activeTab="home"
        linkedInProfile={linkedInProfile}
        onHome={() => {}}
        onCreateNew={onCreateNew}
        onContent={onInbox}
        onProfile={onOpenSettings}
      />
    </div>
  );
}
