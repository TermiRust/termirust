import { useEffect, useState } from "react";

import { commands } from "@/bindings";
import { Onboarding } from "@/features/onboarding/onboarding";

import { AppShell } from "./app-shell";

/** Shows the onboarding on first launch, before anything can touch the OS keychain. */
export function AppRoot() {
  const [phase, setPhase] = useState<"checking" | "onboarding" | "ready">("checking");

  useEffect(() => {
    void commands.onboardingNeeded().then(
      (needed) => setPhase(needed ? "onboarding" : "ready"),
      () => setPhase("ready"),
    );
  }, []);

  if (phase === "checking") return null;
  if (phase === "onboarding") return <Onboarding onDone={() => setPhase("ready")} />;
  return <AppShell />;
}
