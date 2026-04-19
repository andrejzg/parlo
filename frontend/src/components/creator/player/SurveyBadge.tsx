interface SurveyBadgeProps {
  title: string;
  onTap?: () => void;
}

export default function SurveyBadge({ title, onTap }: SurveyBadgeProps) {
  const Tag = onTap ? "button" : "div";

  return (
    <Tag
      onClick={onTap}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-display select-none"
      style={{
        background: "hsl(225 15% 12%)",
        border: "1px solid hsl(225 15% 18%)",
        color: "hsl(40 20% 80%)",
      }}
    >
      <span className="truncate max-w-[180px]">{title}</span>
      {onTap && (
        <svg
          width="8"
          height="8"
          viewBox="0 0 8 8"
          fill="none"
          className="shrink-0"
        >
          <path
            d="M1.5 3L4 5.5L6.5 3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </Tag>
  );
}
