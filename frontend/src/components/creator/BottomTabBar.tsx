import type { LinkedInProfile } from "@/api/client";

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

const inactiveColor = "hsl(225 10% 50%)";
const activeColor = "hsl(22 95% 62%)";

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
      className="absolute bottom-0 left-0 right-0 z-30 flex items-center justify-around px-2 pb-safe"
      style={{
        height: 72,
        background: "hsl(225 25% 4% / 0.92)",
        backdropFilter: "blur(16px)",
        borderTop: "1px solid hsl(225 15% 12%)",
      }}
    >
      {/* Home */}
      <button
        onClick={onHome}
        className="flex flex-col items-center justify-center gap-0.5 min-w-[48px] pt-2"
        aria-label="Home"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={activeTab === "home" ? activeColor : inactiveColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" />
          <path d="M9 21V12h6v9" />
        </svg>
        <span className="text-[10px] font-display" style={{ color: activeTab === "home" ? activeColor : inactiveColor }}>Home</span>
      </button>

      {/* Reels */}
      <button
        onClick={onSearch}
        className="flex flex-col items-center justify-center gap-0.5 min-w-[48px] pt-2 relative"
        aria-label="Reels"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={activeTab === "search" ? activeColor : inactiveColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="18" rx="3" />
          <polygon points="10,8 10,16 16,12" fill={activeTab === "search" ? activeColor : inactiveColor} stroke="none" />
        </svg>
        <span className="text-[10px] font-display" style={{ color: activeTab === "search" ? activeColor : inactiveColor }}>Reels</span>
        {totalNewCount > 0 && (
          <span
            className="absolute top-1 right-0 min-w-[16px] h-4 rounded-full px-1 flex items-center justify-center text-[9px] font-display font-bold"
            style={{
              background: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
            }}
          >
            {totalNewCount}
          </span>
        )}
      </button>

      {/* Create (+ button) */}
      <button
        onClick={onCreateNew}
        className="flex items-center justify-center w-11 h-11 rounded-full -mt-1"
        style={{
          background: "linear-gradient(135deg, hsl(22 95% 58%), hsl(22 95% 66%))",
          boxShadow: "0 4px 16px hsl(22 95% 50% / 0.3)",
        }}
        aria-label="Create new survey"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      </button>

      {/* Inbox — stub */}
      <button
        onClick={onContent}
        className="flex flex-col items-center justify-center gap-0.5 min-w-[48px] pt-2"
        aria-label="Inbox"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={activeTab === "content" ? activeColor : inactiveColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-5 4V6a2 2 0 0 1 2-2z" />
          <line x1="8" y1="10" x2="16" y2="10" />
        </svg>
        <span className="text-[10px] font-display" style={{ color: activeTab === "content" ? activeColor : inactiveColor }}>Inbox</span>
      </button>

      {/* Profile */}
      <button
        onClick={onProfile}
        className="flex flex-col items-center justify-center gap-0.5 min-w-[48px] pt-2"
        aria-label="Profile"
      >
        {profile?.connected && profile.photoUrl ? (
          <>
            <img
              src={profile.photoUrl}
              alt=""
              className="w-6 h-6 rounded-full object-cover"
              style={{
                border: activeTab === "profile" ? `2px solid ${activeColor}` : "1.5px solid hsl(225 15% 18%)",
              }}
            />
            <span className="text-[10px] font-display" style={{ color: activeTab === "profile" ? activeColor : inactiveColor }}>Profile</span>
          </>
        ) : (
          <>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={activeTab === "profile" ? activeColor : inactiveColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M20 21c0-3.87-3.58-7-8-7s-8 3.13-8 7" />
            </svg>
            <span className="text-[10px] font-display" style={{ color: activeTab === "profile" ? activeColor : inactiveColor }}>Profile</span>
          </>
        )}
      </button>
    </div>
  );
}
