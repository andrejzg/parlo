import { useState, useEffect } from "react";
import { fetchLinkedInProfile, type LinkedInProfile } from "@/api/client";
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

function LinkedInIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#0A66C2">
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
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ background: "hsl(225 25% 4%)" }}
    >
      {/* Header */}
      <div className="shrink-0 pt-14 pb-2 px-6">
        <h1
          className="font-display text-xl font-bold"
          style={{ color: "hsl(40 20% 95%)" }}
        >
          Profile
        </h1>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-24">
        {/* Profile card */}
        <div
          className="rounded-2xl px-5 py-5 mt-3"
          style={{
            background: "hsl(225 15% 10%)",
            border: "1px solid hsl(225 15% 14%)",
          }}
        >
          {phone ? (
            isConnected && linkedIn ? (
              <div className="flex items-center gap-4">
                {linkedIn.photoUrl ? (
                  <img
                    src={linkedIn.photoUrl}
                    alt={linkedIn.name ?? ""}
                    className="w-14 h-14 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <div
                    className="w-14 h-14 rounded-full flex items-center justify-center shrink-0 font-display text-lg"
                    style={{
                      background: "hsl(var(--primary) / 0.15)",
                      color: "hsl(var(--primary))",
                      fontWeight: 700,
                    }}
                  >
                    {(linkedIn.name ?? "?").charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0">
                  <p
                    className="text-base font-display font-bold truncate"
                    style={{ color: "hsl(40 20% 95%)" }}
                  >
                    {linkedIn.name}
                  </p>
                  {linkedIn.email && (
                    <p className="text-xs mt-0.5 truncate" style={{ color: "hsl(225 10% 45%)" }}>
                      {linkedIn.email}
                    </p>
                  )}
                  <div className="flex items-center gap-1.5 mt-1">
                    <LinkedInIcon size={12} />
                    <span className="text-[11px] font-display" style={{ color: "#0A66C2" }}>
                      Connected
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <div
                    className="w-14 h-14 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: "hsl(225 15% 12%)", border: "2px dashed hsl(225 15% 22%)" }}
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="hsl(225 10% 30%)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="text-base font-display font-semibold" style={{ color: "hsl(40 20% 95%)" }}>
                      {phone}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: "hsl(225 10% 40%)" }}>
                      Verified
                    </p>
                  </div>
                </div>

                {!loading && (
                  <button
                    onClick={handleConnectLinkedIn}
                    className="flex items-center gap-3 w-full rounded-xl px-4 py-3.5 text-left"
                    style={{
                      background: "hsl(225 15% 8%)",
                      border: "1px dashed hsl(225 15% 20%)",
                    }}
                  >
                    <LinkedInIcon size={18} />
                    <div className="flex-1">
                      <p className="text-sm font-display font-semibold" style={{ color: "hsl(40 20% 85%)" }}>
                        Add your name & photo via LinkedIn
                      </p>
                    </div>
                  </button>
                )}
              </div>
            )
          ) : (
            <div className="flex items-center gap-4">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center shrink-0"
                style={{ background: "hsl(225 15% 12%)" }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="hsl(225 10% 35%)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
              <div>
                <p className="text-base font-display font-semibold" style={{ color: "hsl(40 20% 95%)" }}>
                  Not signed in
                </p>
                <p className="text-xs mt-0.5" style={{ color: "hsl(225 10% 45%)" }}>
                  Verify your phone after creating
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="mt-5 space-y-3">
          {isConnected && (
            <button
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
              className="flex items-center gap-3 w-full rounded-2xl px-5 py-4 text-left"
              style={{
                background: "hsl(225 15% 10%)",
                border: "1px solid hsl(225 15% 14%)",
              }}
            >
              <LinkedInIcon size={16} />
              <span className="text-sm font-display" style={{ color: "hsl(225 10% 50%)" }}>
                Disconnect LinkedIn
              </span>
            </button>
          )}

          {phone ? (
            <button
              onClick={onLogout}
              className="flex items-center justify-center gap-2.5 w-full text-sm font-display font-semibold rounded-2xl py-4"
              style={{
                background: "hsl(0 40% 18%)",
                color: "hsl(0 50% 65%)",
                border: "1px solid hsl(0 30% 25%)",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              Log out
            </button>
          ) : (
            <button
              onClick={onLogin}
              className="flex items-center justify-center gap-2.5 w-full text-sm font-display font-semibold rounded-2xl py-4"
              style={{
                background: "hsl(var(--primary) / 0.12)",
                color: "hsl(var(--primary))",
                border: "1px solid hsl(var(--primary) / 0.25)",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                <polyline points="10 17 15 12 10 7" />
                <line x1="15" y1="12" x2="3" y2="12" />
              </svg>
              Log in
            </button>
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
