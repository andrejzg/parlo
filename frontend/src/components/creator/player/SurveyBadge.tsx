import { ChevronDown } from "lucide-react";

interface SurveyBadgeProps {
  title: string;
  onTap?: () => void;
}

export default function SurveyBadge({ title, onTap }: SurveyBadgeProps) {
  const Tag = onTap ? "button" : "div";

  return (
    <Tag
      onClick={onTap}
      className={`inline-flex select-none items-center gap-xxs rounded-full bg-muted px-s py-xxs font-brand text-xs font-medium text-neutral-8${
        onTap
          ? " transition-colors hover:bg-neutral-4 active:translate-y-press focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring"
          : ""
      }`}
    >
      <span className="truncate max-w-[180px]">{title}</span>
      {onTap && <ChevronDown size={12} className="shrink-0" aria-hidden />}
    </Tag>
  );
}
