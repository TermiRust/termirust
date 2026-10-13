import { Monitor, Server } from "lucide-react";

import { OS_ICONS, osName } from "@/lib/os-catalog";

/** The host's OS logo; a generic server until the first connection has detected it. */
export function OsIcon({ os, size = 16, className }: { os: string | null | undefined; size?: number; className?: string }) {
  const icon = os ? OS_ICONS[os] : undefined;
  if (!icon) {
    const Fallback = os === "windows" ? Monitor : Server;
    return <Fallback size={size} role="img" aria-label={osName(os)} className={className ?? "text-fg-muted"} />;
  }
  // Black logos (macOS, AlmaLinux) would vanish on the dark theme; draw them in text colour.
  const fill = icon.hex === "000000" ? "currentColor" : `#${icon.hex}`;
  return (
    <svg role="img" aria-label={osName(os)} viewBox="0 0 24 24" width={size} height={size} className={className} fill={fill}>
      <path d={icon.path} />
    </svg>
  );
}
