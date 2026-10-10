import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Copy, MessageCircle, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { fadeUp, stagger, transitionLarge } from "@/lib/animations";
import { trackEvent } from "@/lib/posthog";
import { buildShareUrl } from "@/lib/slug";
import { buildBotChatUrl } from "@/lib/whatsapp";

interface AgentReadyScreenProps {
  surveyCode: string;
  surveyTitle?: string | null;
  dashboardCode?: string;
  onDashboard?: () => void;
}

export default function AgentReadyScreen({ surveyCode, surveyTitle, dashboardCode, onDashboard }: AgentReadyScreenProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [dashboardCopied, setDashboardCopied] = useState(false);

  const shareUrl = buildShareUrl(surveyTitle, surveyCode);
  const shareText = `Answer my parlo! ${shareUrl}`;
  const waShareLink = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
  const waNotifyLink = buildBotChatUrl(`Parlo - notify me about parlo ${surveyCode}`);
  const dashboardUrl = `parlo.me/d/${dashboardCode || surveyCode}`;

  const copyDashboardLink = () => {
    navigator.clipboard.writeText(`https://${dashboardUrl}`);
    setDashboardCopied(true);
    setTimeout(() => setDashboardCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full items-center px-l py-l sm:py-xxl overflow-y-auto gap-l bg-background">
      {/* Brand mark */}
      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={transitionLarge}
        className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground"
      >
        Parlo
      </motion.span>

      {/* Main */}
      <motion.div
        className="flex flex-col items-center gap-xl w-full"
        variants={stagger}
        initial="initial"
        animate="animate"
      >
        {/* Pulse icon */}
        <motion.div variants={fadeUp} className="relative flex items-center justify-center">
          <div className="w-24 h-24 rounded-full flex items-center justify-center bg-color-1-transparent">
            <div className="w-16 h-16 rounded-full flex items-center justify-center bg-color-1-transparent text-color-1">
              <Mic size={30} aria-hidden />
            </div>
          </div>
          <span
            className="absolute inset-0 rounded-full shadow-[inset_0_0_0_2px_var(--color-1-transparent)] pulse-ring"
            aria-hidden
          />
        </motion.div>

        {/* Headline */}
        <motion.div variants={fadeUp} className="flex flex-col gap-s text-center">
          <h1 className="font-brand text-xl sm:text-xxl font-heavy text-foreground">
            Your agent is ready.
          </h1>
          <p className="text-m text-neutral-8">
            Share the link to start collecting voice responses.
          </p>
        </motion.div>

        {/* Open / Private toggle */}
        <motion.div variants={fadeUp} className="flex items-center gap-s rounded-m bg-card p-m w-full">
          <div className="flex-1 flex flex-col gap-xxs">
            <Label htmlFor="open-survey">Open parlo</Label>
            <p className="text-xs text-muted-foreground">
              {isOpen ? "Anyone with the link can see results" : "Only you can see results"}
            </p>
          </div>
          <Switch id="open-survey" checked={isOpen} onCheckedChange={setIsOpen} />
        </motion.div>

        {/* Share link card */}
        <motion.div variants={fadeUp} className="w-full flex flex-col gap-s rounded-m bg-card p-m">
          <p className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">
            Share link
          </p>
          <div className="flex items-center gap-s">
            <span className="flex-1 min-w-0 font-data text-s text-foreground break-all">
              {shareUrl.replace(/^https?:\/\//, "")}
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="shrink-0"
              onClick={() => navigator.clipboard.writeText(shareUrl)}
            >
              <Copy aria-hidden />
              Copy
            </Button>
          </div>

          {/* Primary CTA: Share on WhatsApp */}
          <Button size="lg" className="w-full" asChild>
            <a
              href={waShareLink}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackEvent("survey_shared", { surveyCode, method: "whatsapp" })}
            >
              <MessageCircle aria-hidden />
              Share on WhatsApp
            </a>
          </Button>

          {/* Secondary CTA: Get notified */}
          <Button variant="secondary" size="lg" className="w-full" asChild>
            <a
              href={waNotifyLink}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackEvent("survey_notification_opted_in", { surveyCode })}
            >
              Get notified when people respond
            </a>
          </Button>
        </motion.div>

        {/* Dashboard — always visible */}
        <motion.div variants={fadeUp} className="w-full flex flex-col gap-s rounded-m bg-card p-m">
          <div className="flex items-center gap-s">
            <div className="flex-1 min-w-0 flex flex-col gap-xxs">
              <p className="font-brand text-xs font-medium tracking-xl uppercase text-muted-foreground">
                Your dashboard
              </p>
              <span className="font-data text-s text-foreground break-all">{dashboardUrl}</span>
            </div>
            <Button type="button" variant="secondary" size="sm" className="shrink-0" onClick={copyDashboardLink}>
              {dashboardCopied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {dashboardCopied ? "Copied!" : "Copy"}
            </Button>
          </div>

          <Button type="button" variant="link" className="w-full" onClick={onDashboard}>
            Go to agent dashboard
          </Button>
        </motion.div>
      </motion.div>
    </div>
  );
}
