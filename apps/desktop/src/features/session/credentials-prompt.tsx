import { KeyRound, Lock, User } from "lucide-react";
import { useState, type FormEvent } from "react";

import type { PromptedLogin } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogFooter } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export type CredentialsRequest =
  | { kind: "password"; usernameRequired: boolean; savedPasswordRejected: boolean }
  | { kind: "passphrase"; keyLabel: string; wrongPassphrase: boolean; usernameRequired: boolean }
  | { kind: "username" };

interface CredentialsPromptProps {
  hostLabel: string;
  endpoint: string;
  request: CredentialsRequest;
  onSubmit: (login: PromptedLogin) => void;
  onCancel: () => void;
}

function describe(request: CredentialsRequest, hostLabel: string) {
  switch (request.kind) {
    case "password":
      return {
        title: `Log in to ${hostLabel}`,
        note: request.savedPasswordRejected ? "The saved password was rejected. Enter the current one." : undefined,
        icon: <Lock size={15} />,
      };
    case "passphrase":
      return {
        title: `Unlock “${request.keyLabel}”`,
        note: request.wrongPassphrase ? "That passphrase is not correct. Try again." : "This key is protected by a passphrase.",
        icon: <KeyRound size={15} />,
      };
    case "username":
      return { title: `Username for ${hostLabel}`, note: "Which account should this key log in as?", icon: <User size={15} /> };
  }
}

export function CredentialsPrompt({ hostLabel, endpoint, request, onSubmit, onCancel }: CredentialsPromptProps) {
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const askUsername = request.kind === "username" || request.usernameRequired;
  const askSecret = request.kind !== "username";
  const { title, note, icon } = describe(request, hostLabel);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (askUsername && !username.trim()) {
      setError("Username is required");
      return;
    }
    onSubmit({
      username: askUsername ? username.trim() : null,
      password: request.kind === "password" ? secret : null,
      passphrase: request.kind === "passphrase" ? secret : null,
      remember: askSecret && remember,
    });
  };

  return (
    <Dialog open width="sm" onOpenChange={(open) => !open && onCancel()} title={title} description={note ?? endpoint} icon={icon}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        {askUsername && (
          <Field label="Username" error={error ?? undefined}>
            <Input aria-label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          </Field>
        )}
        {askSecret && (
          <Field label={request.kind === "passphrase" ? "Passphrase" : "Password"}>
            <Input
              aria-label={request.kind === "passphrase" ? "Passphrase" : "Password"}
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoFocus={!askUsername}
            />
          </Field>
        )}
        {askSecret && (
          <Checkbox
            label="Remember in vault"
            description="Encrypted on this device. Saved only if the login succeeds."
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
        )}
        <DialogFooter className="justify-end">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Connect
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
