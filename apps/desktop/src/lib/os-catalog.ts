import {
  siAlmalinux,
  siAlpinelinux,
  siArchlinux,
  siCentos,
  siDebian,
  siFedora,
  siFreebsd,
  siGentoo,
  siKalilinux,
  siLinux,
  siLinuxmint,
  siMacos,
  siManjaro,
  siNixos,
  siOpenbsd,
  siOpensuse,
  siRaspberrypi,
  siRedhat,
  siRockylinux,
  siUbuntu,
  type SimpleIcon,
} from "simple-icons";

/** Logos for the OS ids the backend detects (see ssh::host_os). */
export const OS_ICONS: Record<string, SimpleIcon> = {
  ubuntu: siUbuntu,
  debian: siDebian,
  centos: siCentos,
  rhel: siRedhat,
  fedora: siFedora,
  alpine: siAlpinelinux,
  arch: siArchlinux,
  macos: siMacos,
  freebsd: siFreebsd,
  openbsd: siOpenbsd,
  rocky: siRockylinux,
  almalinux: siAlmalinux,
  opensuse: siOpensuse,
  raspbian: siRaspberrypi,
  kali: siKalilinux,
  linuxmint: siLinuxmint,
  manjaro: siManjaro,
  gentoo: siGentoo,
  nixos: siNixos,
  amazon: siLinux,
  linux: siLinux,
};

const NAMES: Record<string, string> = { rhel: "Red Hat Enterprise Linux", amazon: "Amazon Linux", macos: "macOS", windows: "Windows", raspbian: "Raspberry Pi OS" };

/** Human name for a detected OS id, e.g. "ubuntu" → "Ubuntu". */
export function osName(os: string | null | undefined): string {
  if (!os) return "Unknown system";
  return NAMES[os] ?? OS_ICONS[os]?.title ?? os.charAt(0).toUpperCase() + os.slice(1);
}
