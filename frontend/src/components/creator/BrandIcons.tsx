import type { SVGProps } from "react";

/**
 * Brand glyphs for the outputs cards, in the same grammar as Lucide (24 grid,
 * 2 px round stroke, `currentColor`) so they sit beside the Lucide icons on the
 * other cards. Paths are Tabler Icons (MIT): brand-instagram, brand-linkedin,
 * brand-tiktok, brand-google-drive, file-spreadsheet. Lucide has no TikTok or
 * Google Drive, and its own Instagram/LinkedIn are drawn to a slightly
 * different weight, so the whole brand row comes from one set.
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

export function InstagramIcon(props: BrandIconProps) {
  return (
    <Glyph {...props}>
      <path d="M3 7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z" />
      <path d="M8.5 12a3.5 3.5 0 1 0 7 0a3.5 3.5 0 0 0-7 0M17 7v.01" />
    </Glyph>
  );
}

export function LinkedinIcon(props: BrandIconProps) {
  return (
    <Glyph {...props}>
      <path d="M8 11v5m0-8v.01M12 16v-5m4 5v-3a2 2 0 1 0-4 0" />
      <path d="M3 7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z" />
    </Glyph>
  );
}

export function TiktokIcon(props: BrandIconProps) {
  return (
    <Glyph {...props}>
      <path d="M21 7.917v4.034A9.95 9.95 0 0 1 16 10v4.5a6.5 6.5 0 1 1-8-6.326V12.5a2.5 2.5 0 1 0 4 2V3h4.083A6.005 6.005 0 0 0 21 7.917" />
    </Glyph>
  );
}

export function GoogleDriveIcon(props: BrandIconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 10L6 20l-3-5L9 5z" />
      <path d="M9 15h12l-3 5H6m9-5L9 5h6l6 10z" />
    </Glyph>
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
