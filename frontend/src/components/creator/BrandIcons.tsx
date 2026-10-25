import type { SVGProps } from "react";

/**
 * The Google Sheet glyph for the outputs deck, in the same grammar as Lucide
 * (24 grid, 2 px round stroke, `currentColor`) so it sits beside the Lucide
 * icons on the other cards. Path is Tabler Icons (MIT): file-spreadsheet. The
 * Instagram, LinkedIn, TikTok and Drive glyphs went with the channel cards on
 * 2026-10-25 (the deck is content types now).
 */
interface BrandIconProps extends Omit<SVGProps<SVGSVGElement>, "ref"> {
  size?: number;
}

function Glyph({ size = 24, children, ...rest }: BrandIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function GoogleSheetIcon(props: BrandIconProps) {
  return (
    <Glyph {...props}>
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2" />
      <path d="M8 11h8v7H8zm0 4h8m-5-4v7" />
    </Glyph>
  );
}
