import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Reply {
  id: string;
  name: string;
  timestamp: string;
  listened: boolean;
}

const MOCK_REPLIES: Reply[] = [
  { id: "1", name: "Sarah K.", timestamp: "2 min ago", listened: false },
  { id: "2", name: "James R.", timestamp: "14 min ago", listened: false },
  { id: "3", name: "Priya M.", timestamp: "1 hr ago", listened: true },
  { id: "4", name: "Alex T.", timestamp: "3 hr ago", listened: true },
  { id: "5", name: "Jordan W.", timestamp: "5 hr ago", listened: true },
];

interface AgentDashboardProps {
  onBack?: () => void;
}

export default function AgentDashboard({ onBack }: AgentDashboardProps) {
  const [hasReplies, setHasReplies] = useState(false);
  const [activeTab, setActiveTab] = useState<"replies" | "stats">("replies");
  const [replies] = useState<Reply[]>(MOCK_REPLIES);

  const shareUrl = "https://voiceform.app/s/demo-001";
  const shareText = `Hey! I've set up a voice agent for you. Tap to start: ${shareUrl}`;

  return (
    <div
      className="flex flex-col h-full px-6 py-10"
      style={{ background: "hsl(225 25% 4%)" }}
    >
      {/* Agent header */}
      <div className="flex flex-col items-center gap-3 mb-8">
        {/* Avatar */}
        <div className="relative">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{ background: "hsl(var(--primary) / 0.18)" }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"
                stroke="hsl(22, 95%, 62%)"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <path
                d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8"
                stroke="hsl(22, 95%, 62%)"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div
            className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2"
            style={{
              background: hasReplies ? "#25D366" : "hsl(225 10% 35%)",
              borderColor: "hsl(225 25% 4%)",
            }}
          />
        </div>
        <h1
          className="font-display text-xl font-bold"
          style={{ color: "hsl(40 20% 95%)" }}
        >
          My Voice Agent
        </h1>
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        {!hasReplies ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="flex flex-col flex-1 items-center justify-center gap-6"
          >
            <p
              className="text-base font-light"
              style={{ color: "hsl(225 10% 45%)" }}
            >
              No replies yet
            </p>

            {/* Share link */}
            <div className="w-full space-y-3">
              <div
                className="flex items-center gap-3 rounded-xl px-4 py-3 w-full"
                style={{ background: "hsl(225 15% 10%)" }}
              >
                <span
                  className="text-sm flex-1 truncate font-mono"
                  style={{ color: "hsl(40 20% 80%)" }}
                >
                  voiceform.app/s/demo-001
                </span>
                <button
                  className="text-xs font-display font-semibold shrink-0"
                  style={{ color: "hsl(var(--primary))" }}
                  onClick={() => navigator.clipboard.writeText(shareUrl)}
                >
                  Copy
                </button>
              </div>

              <a
                href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-3 w-full rounded-xl py-4 font-display font-semibold text-base"
                style={{ background: "#25D366", color: "#fff" }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
                Share on WhatsApp
              </a>
            </div>

            {/* Toggle for demo */}
            <button
              className="text-xs font-display mt-4"
              style={{ color: "hsl(225 10% 35%)" }}
              onClick={() => setHasReplies(true)}
            >
              (demo: simulate replies)
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="replies"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            className="flex flex-col flex-1"
          >
            {/* Tabs */}
            <div className="flex gap-2 mb-6">
              {(["stats", "replies"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-display font-semibold capitalize transition-colors"
                  style={{
                    background:
                      activeTab === tab
                        ? "hsl(225 15% 14%)"
                        : "transparent",
                    color:
                      activeTab === tab
                        ? "hsl(40 20% 95%)"
                        : "hsl(225 10% 40%)",
                    border:
                      activeTab === tab
                        ? "1px solid hsl(225 15% 20%)"
                        : "1px solid transparent",
                  }}
                >
                  {tab}
                </button>
              ))}
            </div>

            <AnimatePresence mode="wait">
              {activeTab === "replies" ? (
                <motion.div
                  key="replies-list"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col gap-2 flex-1 overflow-y-auto"
                >
                  {replies.map((reply, i) => (
                    <motion.div
                      key={reply.id}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      className="flex items-center gap-4 rounded-xl px-4 py-3.5"
                      style={{ background: "hsl(225 15% 8%)" }}
                    >
                      {/* Avatar circle */}
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-display font-bold"
                        style={{
                          background: reply.listened
                            ? "hsl(225 12% 14%)"
                            : "hsl(var(--primary) / 0.15)",
                          color: reply.listened
                            ? "hsl(225 10% 40%)"
                            : "hsl(var(--primary))",
                        }}
                      >
                        {reply.name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p
                          className="text-sm font-display font-semibold truncate"
                          style={{
                            color: reply.listened
                              ? "hsl(225 10% 50%)"
                              : "hsl(40 20% 95%)",
                          }}
                        >
                          {reply.name}
                        </p>
                        <p
                          className="text-xs"
                          style={{ color: "hsl(225 10% 35%)" }}
                        >
                          {reply.timestamp}
                        </p>
                      </div>
                      {!reply.listened && (
                        <div
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ background: "hsl(var(--primary))" }}
                        />
                      )}
                    </motion.div>
                  ))}
                </motion.div>
              ) : (
                <motion.div
                  key="stats-view"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col gap-4 flex-1"
                >
                  {/* Stat cards */}
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "Total replies", value: "5" },
                      { label: "Unlistened", value: "2" },
                      { label: "Avg. duration", value: "1:24" },
                      { label: "Completion", value: "87%" },
                    ].map((stat) => (
                      <div
                        key={stat.label}
                        className="rounded-xl p-4"
                        style={{ background: "hsl(225 15% 8%)" }}
                      >
                        <p
                          className="text-xs font-display uppercase tracking-wider mb-1"
                          style={{ color: "hsl(225 10% 40%)" }}
                        >
                          {stat.label}
                        </p>
                        <p
                          className="text-2xl font-display font-bold"
                          style={{ color: "hsl(40 20% 95%)" }}
                        >
                          {stat.value}
                        </p>
                      </div>
                    ))}
                  </div>

                  {/* Simple bar chart */}
                  <div
                    className="rounded-xl p-5"
                    style={{ background: "hsl(225 15% 8%)" }}
                  >
                    <p
                      className="text-xs font-display uppercase tracking-wider mb-4"
                      style={{ color: "hsl(225 10% 40%)" }}
                    >
                      Replies this week
                    </p>
                    <div className="flex items-end gap-2 h-24">
                      {[2, 0, 1, 3, 5, 1, 0].map((val, i) => (
                        <motion.div
                          key={i}
                          className="flex-1 rounded-t"
                          initial={{ height: 0 }}
                          animate={{ height: `${(val / 5) * 100}%` }}
                          transition={{ delay: i * 0.06, duration: 0.4 }}
                          style={{
                            background:
                              val > 0
                                ? "hsl(var(--primary) / 0.6)"
                                : "hsl(225 12% 14%)",
                            minHeight: val === 0 ? 4 : undefined,
                          }}
                        />
                      ))}
                    </div>
                    <div className="flex gap-2 mt-2">
                      {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                        <span
                          key={i}
                          className="flex-1 text-center text-[10px] font-display"
                          style={{ color: "hsl(225 10% 30%)" }}
                        >
                          {d}
                        </span>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
