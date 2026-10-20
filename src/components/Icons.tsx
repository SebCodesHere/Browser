import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function IconBase({ size = 18, children, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function XuvonMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="10" fill="url(#xuvon-mark-bg)" />
      <path
        d="M9.4 10.6c2.6-2.2 5.1-2.2 7.1.4l1.3 1.7c1.4 1.8 3.1 1.9 5.1.5-2.4 2.6-4.9 2.7-7.2.1l-1.4-1.8c-1.2-1.5-2.8-1.8-4.9-.9Z"
        fill="#F5FBFF"
      />
      <path
        d="M22.6 21.4c-2.6 2.2-5.1 2.2-7.1-.4l-1.3-1.7c-1.4-1.8-3.1-1.9-5.1-.5 2.4-2.6 4.9-2.7 7.2-.1l1.4 1.8c1.2 1.5 2.8 1.8 4.9.9Z"
        fill="#C9F5E2"
      />
      <circle cx="24.2" cy="8.4" r="2.4" fill="#FFD3BE" />
      <defs>
        <linearGradient id="xuvon-mark-bg" x1="4" y1="1" x2="28" y2="31">
          <stop stopColor="#5B70AC" />
          <stop offset="1" stopColor="#2D3A63" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export const ArrowLeft = (props: IconProps) => (
  <IconBase {...props}>
    <path d="m14.5 5.5-6 6.5 6 6.5" />
  </IconBase>
);

export const ArrowRight = (props: IconProps) => (
  <IconBase {...props}>
    <path d="m9.5 5.5 6 6.5-6 6.5" />
  </IconBase>
);

export const Reload = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M19.5 8.5A8 8 0 1 0 20 15" />
    <path d="M19.5 3.8v4.7h-4.7" />
  </IconBase>
);

export const X = (props: IconProps) => (
  <IconBase {...props}>
    <path d="m6 6 12 12M18 6 6 18" />
  </IconBase>
);

export const Plus = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M12 5v14M5 12h14" />
  </IconBase>
);

export const Search = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="10.8" cy="10.8" r="6.3" />
    <path d="m15.5 15.5 4.3 4.3" />
  </IconBase>
);

export const Shield = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M12 3.2 19 6v5.2c0 4.2-2.8 7.6-7 9.6-4.2-2-7-5.4-7-9.6V6l7-2.8Z" />
  </IconBase>
);

export const ShieldCheck = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M12 3.2 19 6v5.2c0 4.2-2.8 7.6-7 9.6-4.2-2-7-5.4-7-9.6V6l7-2.8Z" />
    <path d="m8.9 11.8 2 2 4.2-4.4" />
  </IconBase>
);

export const ShieldAlert = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M12 3.2 19 6v5.2c0 4.2-2.8 7.6-7 9.6-4.2-2-7-5.4-7-9.6V6l7-2.8Z" />
    <path d="M12 8.2v4.4M12 16.1h.01" />
  </IconBase>
);

export const Lock = (props: IconProps) => (
  <IconBase {...props}>
    <rect x="5" y="10.2" width="14" height="10" rx="3" />
    <path d="M8.5 10.2V8a3.5 3.5 0 0 1 7 0v2.2M12 14.2v2.2" />
  </IconBase>
);

export const Globe = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="M3.8 12h16.4M12 3.6c2.1 2.3 3.2 5.1 3.2 8.4s-1.1 6.1-3.2 8.4c-2.1-2.3-3.2-5.1-3.2-8.4S9.9 5.9 12 3.6Z" />
  </IconBase>
);

export const Star = (props: IconProps) => (
  <IconBase {...props}>
    <path d="m12 3.9 2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8 2.5-5Z" />
  </IconBase>
);

export const StarFilled = ({ size = 18, ...props }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="currentColor"
    strokeWidth="1.4"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >
    <path d="m12 3.9 2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8 2.5-5Z" />
  </svg>
);

export const Grid = (props: IconProps) => (
  <IconBase {...props}>
    <rect x="4" y="4" width="6.2" height="6.2" rx="2" />
    <rect x="13.8" y="4" width="6.2" height="6.2" rx="2" />
    <rect x="4" y="13.8" width="6.2" height="6.2" rx="2" />
    <rect x="13.8" y="13.8" width="6.2" height="6.2" rx="2" />
  </IconBase>
);

export const More = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
  </IconBase>
);

export const Sparkles = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M11.5 3.8c.6 3.1 1.8 4.4 4.9 5.1-3.1.7-4.3 1.9-4.9 5.1-.6-3.2-1.9-4.4-4.9-5.1 3-.7 4.3-2 4.9-5.1Z" />
    <path d="M17.7 13.5c.3 1.8 1 2.5 2.7 2.9-1.7.4-2.4 1.1-2.7 2.9-.4-1.8-1.1-2.5-2.8-2.9 1.7-.4 2.4-1.1 2.8-2.9Z" />
  </IconBase>
);

export const Incognito = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M4 10.8h16M6.2 10.8 8 6.3c.3-.8.9-1.2 1.8-1.2h4.4c.9 0 1.5.4 1.8 1.2l1.8 4.5" />
    <circle cx="7.1" cy="15.1" r="3" />
    <circle cx="16.9" cy="15.1" r="3" />
    <path d="M10.1 15.1h3.8" />
  </IconBase>
);

export const Onion = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M12 3.4c-.7 2.2-2.6 3-2.6 5.1 0 1.6 1.2 2.7 1.2 4.2 0 1.1-.7 1.9-.7 2.9 0 1.5 1.3 2.7 2.1 5 0-2.3 1.3-3.5 1.3-5 0-1-.7-1.8-.7-2.9 0-1.5 1.2-2.6 1.2-4.2 0-2.1-1.9-2.9-1.8-5.1Z" />
    <path d="M9.6 8.1c-1.5 1.4-2.3 3.2-2.3 5.2 0 3 1.9 5 3 7.3M14.4 8.1c1.5 1.4 2.3 3.2 2.3 5.2 0 3-1.9 5-3 7.3" />
  </IconBase>
);

export const Bookmark = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M6.5 4.8c0-1 .8-1.8 1.8-1.8h7.4c1 0 1.8.8 1.8 1.8v15.4L12 16.5l-5.5 3.7V4.8Z" />
  </IconBase>
);

export const Clock = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="12" cy="12" r="8.3" />
    <path d="M12 7.4v5l3.3 2" />
  </IconBase>
);

export const Download = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M12 3.8v10.5M8 10.3l4 4 4-4M4.8 16.7v1.9c0 .9.7 1.6 1.6 1.6h11.2c.9 0 1.6-.7 1.6-1.6v-1.9" />
  </IconBase>
);

export const Settings = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="12" cy="12" r="3.1" />
    <path d="M19 13.8c.1-.6.1-1.2 0-1.8l2-1.6-2-3.4-2.4 1a8.2 8.2 0 0 0-1.6-.9L14.7 4h-4l-.4 2.7c-.6.2-1.1.5-1.6.9L6.3 6.5l-2 3.4 2 1.8c-.1.6-.1 1.2 0 1.8l-2 1.8 2 3.4 2.4-1c.5.4 1 .7 1.6.9l.4 2.7h4l.3-2.7c.6-.2 1.1-.5 1.6-.9l2.4 1 2-3.4-2-1.5Z" />
  </IconBase>
);

export const Moon = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M19.3 14.2A7.7 7.7 0 0 1 9.8 4.7a7.7 7.7 0 1 0 9.5 9.5Z" />
  </IconBase>
);

export const Sun = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="12" cy="12" r="3.7" />
    <path d="M12 2.8v2M12 19.2v2M4.8 4.8 6.2 6.2M17.8 17.8l1.4 1.4M2.8 12h2M19.2 12h2M4.8 19.2l1.4-1.4M17.8 6.2l1.4-1.4" />
  </IconBase>
);

export const Monitor = (props: IconProps) => (
  <IconBase {...props}>
    <rect x="3.5" y="4.5" width="17" height="12" rx="2" />
    <path d="M9 20h6M12 16.5V20" />
  </IconBase>
);

export const Palette = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.9 0-.6-.3-1.1-.6-1.5-.3-.4-.6-.8-.6-1.4 0-1 .8-1.7 1.9-1.7H16a5 5 0 0 0 5-5c0-3.6-4-6.5-9-6.5Z" />
    <circle cx="7.5" cy="11" r="1" fill="currentColor" stroke="none" />
    <circle cx="10" cy="7.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="14.5" cy="7.5" r="1" fill="currentColor" stroke="none" />
  </IconBase>
);

export const ImageIcon = (props: IconProps) => (
  <IconBase {...props}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <circle cx="8.5" cy="9.5" r="1.6" />
    <path d="m3.5 17 4.8-4.6a2 2 0 0 1 2.8 0l2.2 2.1a2 2 0 0 0 2.8 0l1.7-1.6a2 2 0 0 1 2.7 0l1 1" />
  </IconBase>
);

export const Trash = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M4.8 7.2h14.4M9 7.2V4.8c0-.6.5-1.1 1.1-1.1h3.8c.6 0 1.1.5 1.1 1.1v2.4M7.1 7.2l.8 12c.1.8.7 1.3 1.5 1.3h5.2c.8 0 1.4-.5 1.5-1.3l.8-12M10.2 11v6M13.8 11v6" />
  </IconBase>
);

export const Folder = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M3.5 7.2c0-1 .8-1.7 1.7-1.7h4l2 2.1h7.6c1 0 1.7.8 1.7 1.7v8.2c0 1-.8 1.7-1.7 1.7H5.2c-1 0-1.7-.8-1.7-1.7V7.2Z" />
  </IconBase>
);

export const External = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M14.5 4.5h5v5M19 5l-7 7" />
    <path d="M18 13.5v4c0 1.1-.9 2-2 2H6a2 2 0 0 1-2-2v-10c0-1.1.9-2 2-2h4" />
  </IconBase>
);

export const ChevronDown = (props: IconProps) => (
  <IconBase {...props}>
    <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
  </IconBase>
);

export const ChevronLeft = (props: IconProps) => (
  <IconBase {...props}>
    <path d="m14.5 5.5-6 6.5 6 6.5" />
  </IconBase>
);

export const ChevronRight = (props: IconProps) => (
  <IconBase {...props}>
    <path d="m9.5 5.5 6 6.5-6 6.5" />
  </IconBase>
);

export const Check = (props: IconProps) => (
  <IconBase {...props}>
    <path d="m5 12.5 4.2 4.2L19 6.8" />
  </IconBase>
);

export const Info = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 10.7v5M12 7.8h.01" />
  </IconBase>
);

export const AlertTriangle = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M10.3 4.3 2.9 17.1c-.7 1.2.2 2.7 1.6 2.7h15c1.4 0 2.3-1.5 1.6-2.7L13.7 4.3c-.7-1.2-2.4-1.2-3.4 0Z" />
    <path d="M12 9v4.2M12 16.8h.01" />
  </IconBase>
);

export const XCircle = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m9 9 6 6M15 9l-6 6" />
  </IconBase>
);

export const CheckCircle = (props: IconProps) => (
  <IconBase {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m8.2 12.3 2.5 2.5 5.1-5.4" />
  </IconBase>
);

export const Home = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M3.8 10.7 12 3.8l8.2 6.9v8.1c0 .9-.7 1.6-1.6 1.6H5.4c-.9 0-1.6-.7-1.6-1.6v-8.1Z" />
    <path d="M9.2 20.4v-6.2h5.6v6.2" />
  </IconBase>
);

export const Menu = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M4.5 7.5h15M4.5 12h15M4.5 16.5h15" />
  </IconBase>
);

export const Puzzle = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M10 4.5c0-.8.7-1.5 1.5-1.5S13 3.7 13 4.5c0 .5-.2.8-.5 1.2h3.8c.9 0 1.6.7 1.6 1.6v3.8c.4-.3.7-.5 1.2-.5.8 0 1.5.7 1.5 1.5s-.7 1.5-1.5 1.5c-.5 0-.8-.2-1.2-.5v3.8c0 .9-.7 1.6-1.6 1.6h-3.8c.3.4.5.7.5 1.2 0 .8-.7 1.5-1.5 1.5s-1.5-.7-1.5-1.5c0-.5.2-.8.5-1.2H6.7c-.9 0-1.6-.7-1.6-1.6v-3.8c-.4.3-.7.5-1.2.5-.8 0-1.5-.7-1.5-1.5s.7-1.5 1.5-1.5c.5 0 .8.2 1.2.5V7.3c0-.9.7-1.6 1.6-1.6h3.8c-.3-.4-.5-.7-.5-1.2Z" />
  </IconBase>
);

export const Code = (props: IconProps) => (
  <IconBase {...props}>
    <path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15" />
  </IconBase>
);

export const Pause = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M8.3 5v14M15.7 5v14" />
  </IconBase>
);

export const Play = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M7.5 4.8 19 12 7.5 19.2V4.8Z" />
  </IconBase>
);

export const RotateCcw = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M4.5 8.5A8 8 0 1 1 4 15" />
    <path d="M4.5 3.8v4.7h4.7" />
  </IconBase>
);

export const File = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M6.2 3.5h7.1l4.5 4.5v12.5H6.2V3.5Z" />
    <path d="M13.3 3.5V8h4.5" />
  </IconBase>
);

export const EyeOff = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M3 3l18 18M10.6 6.3c.5-.1 1-.2 1.4-.2 5 0 8.5 5.9 8.5 5.9s-1.1 1.9-3 3.5M6.2 7.6C4.2 9.2 3 12 3 12s3.5 5.9 8.5 5.9c1.2 0 2.3-.3 3.3-.8M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </IconBase>
);

export const Link = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M9.8 14.2 14.2 9.8" />
    <path d="M7.5 16.5 5.6 18.4a3.5 3.5 0 0 1-5-5l2.9-2.9a3.5 3.5 0 0 1 5 0M16.5 7.5l1.9-1.9a3.5 3.5 0 0 1 5 5l-2.9 2.9a3.5 3.5 0 0 1-5 0" />
  </IconBase>
);

export const Sliders = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M4 7h10M18 7h2M4 17h3M11 17h9" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </IconBase>
);

export const Pencil = (props: IconProps) => (
  <IconBase {...props}>
    <path d="m5 16.8-.8 3 3-.8L18.6 7.6a2.2 2.2 0 0 0-3.1-3.1L5 16.8Z" />
    <path d="m13.8 6.2 4 4" />
  </IconBase>
);

export const RefreshCcw = RotateCcw;

export const WifiOff = (props: IconProps) => (
  <IconBase {...props}>
    <path d="M3 3l18 18M8.5 8.7A11 11 0 0 1 21 9.8M3 9.8a11 11 0 0 1 2.9-1.7M6.3 13.2A6.4 6.4 0 0 1 12 11.2c.7 0 1.4.1 2 .4M9.1 16.5a3.5 3.5 0 0 1 4.8.2" />
    <circle cx="12" cy="20" r=".6" fill="currentColor" stroke="none" />
  </IconBase>
);

