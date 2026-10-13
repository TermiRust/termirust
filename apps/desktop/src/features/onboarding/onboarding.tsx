import { ArrowRight, Eye, HardDrive, KeyRound, Lock, ShieldCheck, Terminal } from "lucide-react";
import { useState, type ReactNode } from "react";

import { commands } from "@/bindings";
import { Button } from "@/components/ui/button";

import { keyStoreName } from "./key-store-name";

interface OnboardingProps {
  onDone: () => void;
}

/**
 * First launch only. Explains how data is protected before the OS asks for keychain access,
 * so that prompt is expected rather than alarming.
 */
export function Onboarding({ onDone }: OnboardingProps) {
  const [step, setStep] = useState<"welcome" | "keychain">("welcome");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const os = keyStoreName();

  const finish = async () => {
    setBusy(true);
    setError(null);
    const result = await commands.onboardingFinish();
    setBusy(false);
    if (result.status === "ok") onDone();
    else setError(result.error.message);
  };

  return (
    <main aria-label="Welcome to Termirust" className="grid h-full place-items-center overflow-y-auto bg-bg-sunk p-6">
      <div data-tauri-drag-region className="fixed inset-x-0 top-0 h-[38px]" />
      <section className="motion-rise w-[min(560px,100%)] rounded-2xl border border-border bg-bg p-7 shadow-dialog">
        <div className="mb-5 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-accent-fg">
            <Terminal size={20} />
          </span>
          <div>
            <h1 className="text-lg font-semibold">{step === "welcome" ? "Welcome to Termirust" : "One permission, then you're in"}</h1>
            <p className="text-[13px] text-fg-muted">{step === "welcome" ? "An SSH client that keeps your secrets on your machine." : `Termirust keeps its encryption key in ${os.store}.`}</p>
          </div>
        </div>

        {step === "welcome" ? (
          <>
            <ul aria-label="How your data is protected" className="flex flex-col gap-3">
              <Point icon={<Lock size={15} />} title="Encrypted on this device">
                Hosts, passwords and keys are stored in a local vault, each item encrypted with XChaCha20-Poly1305.
              </Point>
              <Point icon={<KeyRound size={15} />} title={`The vault key lives in ${os.store}`}>
                Not in a file, and never typed into Termirust. Termirust never sees or stores your computer password.
              </Point>
              <Point icon={<HardDrive size={15} />} title="No account, no server">
                Nothing leaves this machine. AI help is off until you turn it on with your own key, and it masks secrets first.
              </Point>
              <Point icon={<Eye size={15} />} title="Open source (AGPL-3.0)">
                Anyone can read the code that handles your secrets.
              </Point>
            </ul>
            <div className="mt-6 flex justify-end">
              <Button variant="primary" onClick={() => setStep("keychain")} autoFocus>
                Continue <ArrowRight size={14} />
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start gap-3 rounded-lg border border-border bg-bg-sunk p-3 text-[13px]">
              <ShieldCheck size={18} className="mt-0.5 shrink-0 text-ok" />
              <div className="flex flex-col gap-1.5">
                <p>{os.prompt}</p>
                <p className="text-fg-muted">
                  That window comes from your operating system, not from Termirust. Choose <b className="text-fg">Always Allow</b> so you are not asked on every start.
                </p>
              </div>
            </div>
            {error && (
              <div role="alert" className="mt-3 rounded-md border border-danger-border bg-danger-soft p-2.5 text-[13px] text-danger">
                The vault could not be created: {error}. If you clicked Deny, try again and choose Allow.
              </div>
            )}
            <div className="mt-6 flex justify-between">
              <Button variant="ghost" onClick={() => setStep("welcome")} disabled={busy}>
                Back
              </Button>
              <Button variant="primary" onClick={() => void finish()} disabled={busy} autoFocus>
                {busy ? "Waiting for permission…" : error ? "Try again" : "Create my vault"}
              </Button>
            </div>
          </>
        )}
        <p className="mt-5 text-center text-[11px] text-fg-faint">Step {step === "welcome" ? 1 : 2} of 2</p>
      </section>
    </main>
  );
}

function Point({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-border bg-bg-sunk text-fg-muted">{icon}</span>
      <div>
        <p className="text-[13px] font-medium">{title}</p>
        <p className="text-[13px] text-fg-muted">{children}</p>
      </div>
    </li>
  );
}
