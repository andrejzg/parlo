import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Briefcase, ChevronDown, Copy, LoaderCircle, Shield, UserPlus } from "lucide-react";
import {
  apiErrorMessage,
  createInvite,
  fetchInvites,
  importParticipants,
  type ImportedParticipant,
  type ParticipantInput,
} from "@/api/study";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { copyText } from "@/components/creator/studyUi";
import { transitionSmall } from "@/lib/animations";

interface BringPeopleInProps {
  apiKey: string;
  surveyId: string;
  /** Participants were added: the member list should reload. */
  onPeopleChanged: () => void;
}

type Section = "participants" | "client" | "researcher";

/** The server takes this many people per call; the rest stay in the box for a second go. */
const MAX_ROWS = 200;

const looksLikeEmail = (field: string) => field.includes("@");
/** Mostly digits: an optional +, then 7 to 15 digits once spaces, dots, dashes and brackets are gone. */
const looksLikePhone = (field: string) => /^\+?\d{7,15}$/.test(field.replace(/[\s().-]/g, ""));

/**
 * One pasted line → one participant. Fields are split by commas: the first is
 * the name, one with an @ is the email, one that is mostly digits is the
 * phone, and the last one left over is the segment. Anything between the name
 * and the segment is kept as the descriptor. A line that opens with an email
 * or a phone has no name, which the server accepts.
 */
export function parseParticipantLine(line: string): ParticipantInput {
  const fields = line
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
  const person: ParticipantInput = {};
  const rest: string[] = [];
  fields.forEach((field, index) => {
    if (looksLikeEmail(field)) {
      if (!person.email) person.email = field;
    } else if (looksLikePhone(field)) {
      if (!person.phone) person.phone = field;
    } else if (index === 0) {
      person.name = field;
    } else {
      rest.push(field);
    }
  });
  const segment = rest.pop();
  if (segment) person.segment = segment;
  if (rest.length > 0) person.descriptor = rest.join(", ");
  return person;
}

interface ImportResult {
  participants: ImportedParticipant[];
  skipped: { line: string; reason: string }[];
}

function LinkRow({ link, testId }: { link: string; testId: string }) {
  return (
    <div className="flex items-center gap-s rounded-s bg-muted pl-s pr-xs py-xs" data-testid={testId}>
      <span className="flex-1 truncate font-data text-s text-neutral-8">{link.replace(/^https?:\/\//, "")}</span>
      <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={() => copyText(link)}>
        <Copy aria-hidden />
        Copy
      </Button>
    </div>
  );
}

function ActionSection({
  id,
  icon,
  label,
  open,
  first,
  onToggle,
  children,
}: {
  id: string;
  icon: React.ReactNode;
  label: string;
  open: boolean;
  first?: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={first ? undefined : "shadow-edge-t"}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        className="flex w-full items-center gap-s p-m text-left rounded-m focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring"
        data-testid={id}
      >
        <span className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-muted text-neutral-8 [&_svg]:size-4">{icon}</span>
        <span className="flex-1 text-s font-medium text-foreground">{label}</span>
        <ChevronDown size={16} className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={`${id}-panel`}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={transitionSmall}
            className="overflow-hidden"
          >
            {/* The top padding leaves room for the first field's focus outline. */}
            <div className="flex flex-col gap-s px-m pt-xxs pb-m">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * How the research team brings people into a study: participants by name
 * (each gets a personal link), the client who commissioned it, and
 * co-researchers. One action is open at a time.
 */
export default function BringPeopleIn({ apiKey, surveyId, onPeopleChanged }: BringPeopleInProps) {
  const [open, setOpen] = useState<Section | null>(null);
  const toggle = (section: Section) => setOpen((current) => (current === section ? null : section));

  // Participants
  const [text, setText] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  // Invites: one reusable link per seat kind.
  const [sponsorName, setSponsorName] = useState("");
  const [sponsor, setSponsor] = useState<string | null>(null);
  const [clientLink, setClientLink] = useState<string | null>(null);
  const [researcherLink, setResearcherLink] = useState<string | null>(null);
  const [inviting, setInviting] = useState<"client" | "admin" | null>(null);

  // Links made on an earlier visit are shown again without another tap.
  useEffect(() => {
    let cancelled = false;
    fetchInvites(apiKey, surveyId)
      .then((r) => {
        if (cancelled) return;
        setSponsor(r.sponsor);
        setClientLink(r.invites.find((i) => i.role === "client")?.link ?? null);
        setResearcherLink(r.invites.find((i) => i.role === "admin")?.link ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [apiKey, surveyId]);

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const sendCount = Math.min(lines.length, MAX_ROWS);
  const addLabel = sendCount === 0 ? "Add participants" : sendCount === 1 ? "Add 1 person" : `Add ${sendCount} people`;

  const handleImport = async () => {
    const sent = lines.slice(0, MAX_ROWS);
    if (sent.length === 0 || importing) return;
    setImporting(true);
    try {
      const r = await importParticipants(apiKey, surveyId, sent.map(parseParticipantLine));
      setResult({
        participants: r.participants,
        // `row` counts from 1 through the lines that were sent.
        skipped: r.skipped.map((s) => ({ line: sent[s.row - 1] ?? `Line ${s.row}`, reason: s.reason })),
      });
      setText(lines.slice(MAX_ROWS).join("\n"));
      const added = r.participants.filter((p) => p.added).length;
      if (added > 0) toast.success(`${added} ${added === 1 ? "person" : "people"} added.`);
      else if (r.participants.length > 0) toast.success("They were already here. Their links are below.");
      else toast.error("Nobody was added.");
      if (r.participants.length > 0) onPeopleChanged();
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't add them."));
    } finally {
      setImporting(false);
    }
  };

  const handleInvite = async (role: "client" | "admin") => {
    setInviting(role);
    try {
      const invite = await createInvite(apiKey, surveyId, role, role === "client" ? sponsorName.trim() || undefined : undefined);
      if (role === "client") {
        setClientLink(invite.link);
        setSponsor(invite.sponsor);
      } else {
        setResearcherLink(invite.link);
      }
    } catch (err) {
      toast.error(apiErrorMessage(err, "Couldn't make the link."));
    } finally {
      setInviting(null);
    }
  };

  const copyAll = () => {
    if (!result) return;
    copyText(result.participants.map((p) => `${p.name ?? ""}\t${p.link}`).join("\n"));
  };

  return (
    <div className="rounded-m bg-card" data-testid="bring-people-in">
      <ActionSection
        id="bring-participants"
        icon={<UserPlus aria-hidden />}
        label="Add participants"
        open={open === "participants"}
        first
        onToggle={() => toggle("participants")}
      >
        <div className="flex flex-col gap-xs">
          <label htmlFor="participants-input" className="text-xs text-muted-foreground">
            One person per line: name, then a phone or an email (optional), then a segment (optional).
          </label>
          <Textarea
            id="participants-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Dana Whitfield, dana@example.com, Customer"
            rows={4}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={importing}
            data-testid="participants-input"
          />
        </div>
        <p className="text-xs text-muted-foreground">Each person gets a personal link. Only answers that come in through a personal link are paid.</p>
        <Button type="button" onClick={handleImport} disabled={importing || lines.length === 0} data-testid="participants-submit">
          {importing ? <LoaderCircle className="animate-spin" aria-hidden /> : <UserPlus aria-hidden />}
          {importing ? "Adding" : addLabel}
        </Button>

        {result && (
          <div className="flex flex-col gap-xs" data-testid="participants-result">
            {result.participants.length > 0 && (
              <>
                <div className="flex items-center justify-between gap-s">
                  <p className="text-s font-medium text-foreground">Personal links</p>
                  <Button type="button" size="sm" variant="secondary" onClick={copyAll} data-testid="participants-copy-all">
                    <Copy aria-hidden />
                    Copy all
                  </Button>
                </div>
                <ul className="flex flex-col gap-xs">
                  {result.participants.map((p, i) => (
                    <li key={`${p.userId}-${i}`} className="flex items-center gap-s rounded-s bg-muted pl-s pr-xs py-xs" data-testid="imported-participant">
                      <div className="flex-1 min-w-0">
                        <p className="text-s text-foreground truncate">{p.name || "Participant"}</p>
                        {(p.segment || !p.added) && (
                          <p className="text-xs text-muted-foreground truncate">{[p.segment, p.added ? null : "Already a participant"].filter(Boolean).join(" · ")}</p>
                        )}
                      </div>
                      <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={() => copyText(p.link)}>
                        Copy link
                      </Button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {result.skipped.length > 0 && (
              <ul className="flex flex-col gap-xs" data-testid="participants-skipped">
                {result.skipped.map((s, i) => (
                  <li key={i} className="rounded-s bg-error-transparent px-s py-xs">
                    <p className="text-s text-foreground truncate">{s.line}</p>
                    <p className="text-xs text-neutral-8">Skipped. {s.reason}.</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </ActionSection>

      <ActionSection id="bring-client" icon={<Briefcase aria-hidden />} label="Invite the client" open={open === "client"} onToggle={() => toggle("client")}>
        <p className="text-xs text-muted-foreground">
          The client can hear raw answers, shape the brief and steer. They can't send rounds, see phone numbers or manage people.
        </p>
        {clientLink ? (
          <>
            <LinkRow link={clientLink} testId="client-invite-link" />
            <p className="text-xs text-neutral-8" data-testid="client-invite-note">
              From now on, participants are told that {sponsor || "the client"} hears their answers. Answers given before this stay with the research team.
            </p>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-xs">
              <Label htmlFor="client-sponsor">Who commissioned this study?</Label>
              <Input
                id="client-sponsor"
                value={sponsorName}
                onChange={(e) => setSponsorName(e.target.value)}
                placeholder="Acme, or leave blank for a blind study"
                maxLength={80}
                disabled={inviting !== null}
                data-testid="client-sponsor-input"
              />
            </div>
            <p className="text-xs text-muted-foreground">Once the link exists, participants are told who hears their answers.</p>
            <Button type="button" onClick={() => handleInvite("client")} disabled={inviting !== null} data-testid="client-invite-create">
              {inviting === "client" && <LoaderCircle className="animate-spin" aria-hidden />}
              Make the client link
            </Button>
          </>
        )}
      </ActionSection>

      <ActionSection
        id="bring-researcher"
        icon={<Shield aria-hidden />}
        label="Invite a co-researcher"
        open={open === "researcher"}
        onToggle={() => toggle("researcher")}
      >
        <p className="text-xs text-muted-foreground">Anyone who opens this link joins the research team as an admin.</p>
        {researcherLink ? (
          <LinkRow link={researcherLink} testId="researcher-invite-link" />
        ) : (
          <Button type="button" onClick={() => handleInvite("admin")} disabled={inviting !== null} data-testid="researcher-invite-create">
            {inviting === "admin" && <LoaderCircle className="animate-spin" aria-hidden />}
            Make the link
          </Button>
        )}
      </ActionSection>
    </div>
  );
}
