/** Common ProxyCommand setups; `fill` is the part the user still has to replace, if any. */
export interface ProxyPreset {
  label: string;
  command: string;
  fill?: string;
}

export const PROXY_PRESETS: ProxyPreset[] = [
  { label: "Cloudflare Tunnel", command: "cloudflared access ssh --hostname %h" },
  { label: "Bastion (ssh -W)", command: "ssh -W %h:%p user@bastion", fill: "user@bastion" },
  { label: "SOCKS proxy", command: "nc -X 5 -x 127.0.0.1:1080 %h %p", fill: "127.0.0.1:1080" },
  { label: "AWS SSM", command: "aws ssm start-session --target %h --document-name AWS-StartSSHSession --parameters portNumber=%p" },
  { label: "Google Cloud IAP", command: "gcloud compute start-iap-tunnel %h %p --listen-on-stdin --zone=ZONE", fill: "ZONE" },
];

/** Where the part to replace sits in the command, to select it after filling; null if none. */
export function fillRange(preset: ProxyPreset): [number, number] | null {
  if (!preset.fill) return null;
  const start = preset.command.indexOf(preset.fill);
  return start < 0 ? null : [start, start + preset.fill.length];
}
