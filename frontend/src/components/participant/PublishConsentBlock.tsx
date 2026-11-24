import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { PublishConsent } from "@/api/client";
import { cn } from "@/lib/utils";

interface PublishConsentBlockProps {
  value: PublishConsent;
  onChange: (value: PublishConsent) => void;
}

/**
 * A study's consent screen: may what this person says end up in public
 * material? A separate yes from taking part, and off unless they turn it on.
 * Two steps, the second only open once the first is given:
 *   none  → nothing leaves the study
 *   quote → their words may be quoted, without their name
 *   voice → their recorded voice may be used too
 */
export default function PublishConsentBlock({ value, onChange }: PublishConsentBlockProps) {
  const quote = value !== "none";
  const voice = value === "voice";

  return (
    <div
      className="w-full rounded-m bg-card p-m flex flex-col gap-s text-left"
      data-testid="publish-consent"
      data-value={value}
    >
      <div className="flex flex-col gap-xxs">
        <h2 className="text-s font-medium text-foreground">Can we quote you?</h2>
        <p className="text-xs text-muted-foreground">Optional. Your answers count either way.</p>
      </div>

      <div className="flex items-center gap-s">
        <Label htmlFor="publish-quote" className="flex-1 font-regular">
          My words can be quoted in public material, without my name.
        </Label>
        {/* Turning this off takes the voice permission with it. */}
        <Switch
          id="publish-quote"
          checked={quote}
          onCheckedChange={(on) => onChange(on ? "quote" : "none")}
          data-testid="publish-quote"
        />
      </div>

      <div className="flex items-center gap-s">
        <Label htmlFor="publish-voice" className={cn("flex-1 font-regular", !quote && "text-neutral-6")}>
          My recorded voice can be used too.
        </Label>
        <Switch
          id="publish-voice"
          checked={voice}
          disabled={!quote}
          onCheckedChange={(on) => onChange(on ? "voice" : "quote")}
          data-testid="publish-voice"
        />
      </div>
    </div>
  );
}
