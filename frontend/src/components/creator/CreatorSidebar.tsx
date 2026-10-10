import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { LogIn, LogOut, Menu, User, X } from "lucide-react";
import { fetchLinkedInProfile, type LinkedInProfile } from "@/api/client";
import { Button } from "@/components/ui/button";
import { transitionSmall } from "@/lib/animations";

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
    <Button
      type="button"
      variant="secondary"
      size="icon"
      onClick={onClick}
      aria-label="Open menu"
      className="fixed top-4 left-4 z-50"
    >
      <Menu aria-hidden />
    </Button>
  );
}

/** Third-party brand glyph kept as artwork; its colour comes from `text-linkedin`. */
function LinkedInIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className="shrink-0 text-linkedin" aria-hidden>
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
            className="fixed inset-0 z-[60] bg-neutral-1-transparent"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transitionSmall}
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            className="fixed top-0 left-0 bottom-0 z-[70] flex flex-col bg-card shadow-m"
            // Structural: drawer width.
            style={{ width: "min(80vw, 320px)" }}
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", visualDuration: 0.28, bounce: 0.2 }}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-l pt-xxl pb-m">
              <span className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">
                Parlo
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onClose}
                aria-label="Close menu"
                className="-mr-xs"
              >
                <X className="!size-5" aria-hidden />
              </Button>
            </div>

            {/* Profile section */}
            <div className="px-l py-l shadow-edge-b">
              {phone ? (
                isConnected && linkedIn ? (
                  /* ── LinkedIn connected: show real profile ── */
                  <div className="flex items-center gap-s">
                    {linkedIn.photoUrl ? (
                      <img
                        src={linkedIn.photoUrl}
                        alt={linkedIn.name ?? ""}
                        className="w-11 h-11 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 bg-muted text-s font-medium text-neutral-8">
                        {(linkedIn.name ?? "?").charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-s font-medium text-foreground truncate">
                        {linkedIn.name}
                      </p>
                      <div className="flex items-center gap-xs mt-xxs">
                        <LinkedInIcon size={12} />
                        <span className="text-xxs text-linkedin">
                          Connected
                        </span>
                        <span className="text-xxs text-neutral-6">·</span>
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
                          className="rounded-xs text-xxs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring"
                        >
                          Disconnect
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* ── Logged in but LinkedIn not connected: show nudge ── */
                  <div className="space-y-m">
                    <div className="flex items-center gap-s">
                      <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 bg-muted text-muted-foreground">
                        <User size={18} aria-hidden />
                      </div>
                      <div className="min-w-0">
                        <p className="text-s font-medium text-foreground">
                          {phone}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Verified
                        </p>
                      </div>
                    </div>

                    {/* Profile completion nudges */}
                    {!loading && (
                      <button
                        type="button"
                        onClick={handleConnectLinkedIn}
                        className="flex items-center gap-s w-full rounded-s bg-muted px-s py-s text-left transition-colors hover:bg-neutral-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring"
                      >
                        <LinkedInIcon size={16} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-neutral-8">
                            Add your name & photo
                          </p>
                          <p className="text-xxs text-muted-foreground">
                            via LinkedIn
                          </p>
                        </div>
                      </button>
                    )}
                  </div>
                )
              ) : (
                /* ── Not logged in ── */
                <div className="flex items-center gap-s">
                  <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 bg-muted text-muted-foreground">
                    <User size={18} aria-hidden />
                  </div>
                  <div>
                    <p className="text-s font-medium text-foreground">
                      Not signed in
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Verify your phone after creating
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            {/* Footer */}
            <div className="px-l py-l space-y-m shadow-edge-t">
              {phone ? (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => { onClose(); onLogout?.(); }}
                >
                  <LogOut aria-hidden />
                  Log out
                </Button>
              ) : (
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => { onClose(); onLogin?.(); }}
                >
                  <LogIn aria-hidden />
                  Log in
                </Button>
              )}
              <p className="text-xxs text-neutral-6">
                Powered by Parlo
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
