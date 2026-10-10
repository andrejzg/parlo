import { Clapperboard, Home, Inbox, Plus, User } from "lucide-react";
import type { LinkedInProfile } from "@/api/client";
import { Button } from "@/components/ui/button";

type Tab = "home" | "search" | "content" | "profile";

interface BottomTabBarProps {
  activeTab: Tab;
  totalNewCount: number;
  linkedInProfile?: LinkedInProfile | null;
  onHome: () => void;
  onSearch: () => void;
  onCreateNew: () => void;
  onContent: () => void;
  onProfile: () => void;
}

const tabClass =
  "flex flex-col items-center justify-center gap-xxs min-w-[48px] pt-xs rounded-s transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring";

function tabTone(active: boolean) {
  return active ? "text-color-1" : "text-muted-foreground";
}

export default function BottomTabBar({
  activeTab,
  totalNewCount,
  linkedInProfile,
  onHome,
  onSearch,
  onCreateNew,
  onContent,
  onProfile,
}: BottomTabBarProps) {
  const profile = linkedInProfile;

  return (
    <div
      className="absolute bottom-0 left-0 right-0 z-30 flex items-center justify-around px-xs pb-safe bg-background shadow-edge-t"
      // Structural: fixed bar height that screens pad for; not a theme value.
      style={{ height: 72 }}
    >
      {/* Home */}
      <button onClick={onHome} className={`${tabClass} ${tabTone(activeTab === "home")}`} aria-label="Home">
        <Home size={20} aria-hidden />
        <span className="font-brand text-xxs">Home</span>
      </button>

      {/* Reels */}
      <button
        onClick={onSearch}
        className={`${tabClass} ${tabTone(activeTab === "search")} relative`}
        aria-label="Reels"
      >
        <Clapperboard size={20} aria-hidden />
        <span className="font-brand text-xxs">Reels</span>
        {totalNewCount > 0 && (
          <span className="absolute top-1 right-0 min-w-[16px] h-4 rounded-full px-xxs flex items-center justify-center bg-badge text-badge-foreground font-data text-xxs font-medium">
            {totalNewCount}
          </span>
        )}
      </button>

      {/* Create (+ button) */}
      <Button size="icon" onClick={onCreateNew} aria-label="Create new parlo" className="-mt-1">
        <Plus className="!size-5" aria-hidden />
      </Button>

      {/* Inbox — stub */}
      <button onClick={onContent} className={`${tabClass} ${tabTone(activeTab === "content")}`} aria-label="Inbox">
        <Inbox size={20} aria-hidden />
        <span className="font-brand text-xxs">Inbox</span>
      </button>

      {/* Profile */}
      <button onClick={onProfile} className={`${tabClass} ${tabTone(activeTab === "profile")}`} aria-label="Profile">
        {profile?.connected && profile.photoUrl ? (
          <img
            src={profile.photoUrl}
            alt=""
            // Rings reference theme variables; an outset ring is used because an
            // inset edge is hidden behind an image's own pixels.
            className={`w-6 h-6 rounded-full object-cover ${
              activeTab === "profile" ? "shadow-[0_0_0_2px_var(--color-1)]" : "shadow-[0_0_0_1px_var(--neutral-4)]"
            }`}
          />
        ) : (
          <User size={20} aria-hidden />
        )}
        <span className="font-brand text-xxs">Profile</span>
      </button>
    </div>
  );
}
