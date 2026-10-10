import { useState, useEffect } from "react";
import { LogIn, LogOut, User } from "lucide-react";
import { fetchLinkedInProfile, type LinkedInProfile } from "@/api/client";
import { Button } from "@/components/ui/button";
import BottomTabBar from "./BottomTabBar";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

interface ProfilePageProps {
  phone: string | null;
  linkedInProfile?: LinkedInProfile | null;
  totalNewCount: number;
  onLogout?: () => void;
  onLogin?: () => void;
  onLinkedInConnected?: (profile: LinkedInProfile) => void;
  onHome: () => void;
  onSearch: () => void;
  onCreateNew: () => void;
  onInbox?: () => void;
}

/** Third-party brand glyph kept as artwork; its colour comes from `text-linkedin`. */
function LinkedInIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className="shrink-0 text-linkedin" aria-hidden>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

export default function ProfilePage({
  phone,
  linkedInProfile: initialProfile,
  totalNewCount,
  onLogout,
  onLogin,
  onHome,
  onSearch,
  onCreateNew,
  onInbox,
}: ProfilePageProps) {
  const [linkedIn, setLinkedIn] = useState<LinkedInProfile | null>(initialProfile ?? null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (phone && !initialProfile) {
      setLoading(true);
      fetchLinkedInProfile(phone)
        .then(setLinkedIn)
        .catch(() => setLinkedIn({ connected: false }))
        .finally(() => setLoading(false));
    }
  }, [phone, initialProfile]);

  const handleConnectLinkedIn = () => {
    if (!phone) return;
    window.location.href = `${API_BASE}/auth/linkedin/start?phone=${encodeURIComponent(phone)}`;
  };

  const isConnected = linkedIn?.connected === true;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Header */}
      <div className="shrink-0 pt-xxl pb-xs px-l">
        <h1 className="font-brand text-l font-heavy text-foreground">
          Profile
        </h1>
      </div>

      {/* Content — pb-24 clears the 72px tab bar plus its safe-area padding */}
      <div className="flex-1 min-h-0 overflow-y-auto px-l pb-24">
        {/* Profile card */}
        <div className="rounded-m bg-card p-m mt-s">
          {phone ? (
            isConnected && linkedIn ? (
              <div className="flex items-center gap-m">
                {linkedIn.photoUrl ? (
                  <img
                    src={linkedIn.photoUrl}
                    alt={linkedIn.name ?? ""}
                    className="w-14 h-14 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-full flex items-center justify-center shrink-0 bg-muted text-m font-medium text-neutral-8">
                    {(linkedIn.name ?? "?").charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-m font-medium text-foreground truncate">
                    {linkedIn.name}
                  </p>
                  {linkedIn.email && (
                    <p className="text-xs text-muted-foreground truncate">
                      {linkedIn.email}
                    </p>
                  )}
                  <div className="flex items-center gap-xs mt-xxs">
                    <LinkedInIcon size={12} />
                    <span className="text-xxs text-linkedin">
                      Connected
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-m">
                <div className="flex items-center gap-m">
                  <div className="w-14 h-14 rounded-full flex items-center justify-center shrink-0 bg-muted text-muted-foreground">
                    <User size={22} aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <p className="text-m font-medium text-foreground">
                      {phone}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Verified
                    </p>
                  </div>
                </div>

                {!loading && (
                  <button
                    type="button"
                    onClick={handleConnectLinkedIn}
                    className="flex items-center gap-s w-full rounded-s bg-muted px-s py-s text-left transition-colors hover:bg-neutral-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring"
                  >
                    <LinkedInIcon size={18} />
                    <p className="flex-1 text-s font-medium text-neutral-8">
                      Add your name & photo via LinkedIn
                    </p>
                  </button>
                )}
              </div>
            )
          ) : (
            <div className="flex items-center gap-m">
              <div className="w-14 h-14 rounded-full flex items-center justify-center shrink-0 bg-muted text-muted-foreground">
                <User size={22} aria-hidden />
              </div>
              <div>
                <p className="text-m font-medium text-foreground">
                  Not signed in
                </p>
                <p className="text-xs text-muted-foreground">
                  Verify your phone after creating
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="mt-l space-y-s">
          {isConnected && (
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={async () => {
                try {
                  await fetch(`${API_BASE}/auth/linkedin/disconnect`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ phone }),
                  });
                  setLinkedIn({ connected: false });
                } catch {}
              }}
            >
              <LinkedInIcon size={16} />
              Disconnect LinkedIn
            </Button>
          )}

          {phone ? (
            <Button type="button" variant="outline" className="w-full" onClick={onLogout}>
              <LogOut aria-hidden />
              Log out
            </Button>
          ) : (
            <Button type="button" className="w-full" onClick={onLogin}>
              <LogIn aria-hidden />
              Log in
            </Button>
          )}
        </div>
      </div>

      <BottomTabBar
        activeTab="profile"
        totalNewCount={totalNewCount}
        linkedInProfile={initialProfile}
        onHome={onHome}
        onSearch={onSearch}
        onCreateNew={onCreateNew}
        onContent={onInbox ?? (() => {})}
        onProfile={() => {}}
      />
    </div>
  );
}
