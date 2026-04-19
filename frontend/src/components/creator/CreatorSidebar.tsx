import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { fetchLinkedInProfile, type LinkedInProfile } from "@/api/client";


interface CreatorSidebarProps {
  open: boolean;
  onClose: () => void;
  phone: string | null;
  onLogout?: () => void;
  onLogin?: () => void;
  onLinkedInConnected?: (profile: LinkedInProfile) => void;
}

const API_BASE = import.meta.env.VITE_API_URL || "/api";

export function MenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="fixed top-4 left-4 z-50 flex flex-col justify-center gap-[5px] w-10 h-10 rounded-xl transition-colors"
      style={{ background: "hsl(225 15% 10% / 0.6)" }}
      aria-label="Open menu"
    >
      <span
        className="block h-[2px] rounded-full ml-2.5"
        style={{ width: 18, background: "hsl(225 10% 55%)" }}
      />
      <span
        className="block h-[2px] rounded-full ml-2.5"
        style={{ width: 13, background: "hsl(225 10% 55%)" }}
      />
    </button>
  );
}

function LinkedInIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#0A66C2">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
    </svg>
  );
}

export default function CreatorSidebar({ open, onClose, phone, onLogout, onLogin, onLinkedInConnected }: CreatorSidebarProps) {
  const [linkedIn, setLinkedIn] = useState<LinkedInProfile | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch LinkedIn profile when sidebar opens and user is logged in
  useEffect(() => {
    if (open && phone) {
      setLoading(true);
      fetchLinkedInProfile(phone)
        .then(setLinkedIn)
        .catch(() => setLinkedIn({ connected: false }))
        .finally(() => setLoading(false));
    }
  }, [open, phone]);

  const handleConnectLinkedIn = () => {
    if (!phone) return;
    // Redirect to backend OAuth start endpoint
    window.location.href = `${API_BASE}/auth/linkedin/start?phone=${encodeURIComponent(phone)}`;
  };

  const isConnected = linkedIn?.connected === true;

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-[60]"
            style={{ background: "rgba(0,0,0,0.5)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            className="fixed top-0 left-0 bottom-0 z-[70] flex flex-col"
            style={{
              width: "min(80vw, 320px)",
              background: "hsl(225 20% 7%)",
              borderRight: "1px solid hsl(225 15% 14%)",
            }}
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-14 pb-4">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary" />
                <span
                  className="text-xs font-display tracking-widest uppercase"
                  style={{ color: "hsl(225 10% 55%)" }}
                >
                  Parlo
                </span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex items-center justify-center w-8 h-8 rounded-lg transition-colors"
                style={{ color: "hsl(225 10% 45%)" }}
                aria-label="Close menu"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Profile section */}
            <div className="px-5 py-5 border-b" style={{ borderColor: "hsl(225 15% 14%)" }}>
              {phone ? (
                isConnected && linkedIn ? (
                  /* ── LinkedIn connected: show real profile ── */
                  <div className="flex items-center gap-3">
                    {linkedIn.photoUrl ? (
                      <img
                        src={linkedIn.photoUrl}
                        alt={linkedIn.name ?? ""}
                        className="w-11 h-11 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div
                        className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 font-display text-sm"
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
                        className="text-sm font-display font-semibold truncate"
                        style={{ color: "hsl(40 20% 95%)" }}
                      >
                        {linkedIn.name}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <LinkedInIcon size={12} />
                        <span className="text-[10px] font-display" style={{ color: "#0A66C2" }}>
                          Connected
                        </span>
                        <span className="text-[10px]" style={{ color: "hsl(225 10% 30%)" }}>·</span>
                        <button
                          type="button"
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
                          className="text-[10px] font-display"
                          style={{ color: "hsl(225 10% 35%)" }}
                        >
                          Disconnect
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* ── Logged in but LinkedIn not connected: show nudge ── */
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: "hsl(225 15% 12%)", border: "2px dashed hsl(225 15% 22%)" }}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="hsl(225 10% 30%)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                          <circle cx="12" cy="7" r="4" />
                        </svg>
                      </div>
                      <div className="min-w-0">
                        <p
                          className="text-sm font-display font-semibold"
                          style={{ color: "hsl(40 20% 95%)" }}
                        >
                          {phone}
                        </p>
                        <p className="text-xs" style={{ color: "hsl(225 10% 40%)" }}>
                          Verified
                        </p>
                      </div>
                    </div>

                    {/* Profile completion nudges */}
                    {!loading && (
                      <div className="space-y-2">
                        <button
                          onClick={handleConnectLinkedIn}
                          className="flex items-center gap-3 w-full rounded-xl px-3.5 py-3 text-left transition-colors"
                          style={{
                            background: "hsl(225 15% 10%)",
                            border: "1px dashed hsl(225 15% 20%)",
                          }}
                        >
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                            style={{ background: "hsl(225 15% 14%)" }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="hsl(225 10% 35%)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                              <circle cx="12" cy="7" r="4" />
                            </svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-display font-semibold" style={{ color: "hsl(40 20% 85%)" }}>
                              Add your name & photo
                            </p>
                            <p className="text-[10px]" style={{ color: "hsl(225 10% 40%)" }}>
                              via LinkedIn
                            </p>
                          </div>
                          <LinkedInIcon size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                )
              ) : (
                /* ── Not logged in ── */
                <div className="flex items-center gap-3">
                  <div
                    className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: "hsl(225 15% 12%)" }}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="hsl(225 10% 35%)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </div>
                  <div>
                    <p
                      className="text-sm font-display font-semibold"
                      style={{ color: "hsl(40 20% 95%)" }}
                    >
                      Not signed in
                    </p>
                    <p className="text-xs" style={{ color: "hsl(225 10% 45%)" }}>
                      Verify your phone after creating
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Footer */}
            <div className="px-5 py-6 space-y-4" style={{ borderTop: "1px solid hsl(225 15% 14%)" }}>
              {phone ? (
                <button
                  type="button"
                  onClick={() => { onClose(); onLogout?.(); }}
                  className="flex items-center justify-center gap-2.5 w-full text-sm font-display font-semibold rounded-xl py-3 transition-colors"
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
                  type="button"
                  onClick={() => { onClose(); onLogin?.(); }}
                  className="flex items-center justify-center gap-2.5 w-full text-sm font-display font-semibold rounded-xl py-3 transition-colors"
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
              <p className="text-[10px]" style={{ color: "hsl(225 10% 30%)" }}>
                Powered by Parlo
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
