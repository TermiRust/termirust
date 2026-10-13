import { useState, type FormEvent } from "react";

import type { PromptedLogin } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

interface PasswordPromptProps {
  hostLabel: string;
  usernameRequired: boolean;
  savedPasswordRejected: boolean;
  onSubmit: (login: PromptedLogin) => void;
  onCancel: () => void;
}

export function PasswordPrompt({ hostLabel, usernameRequired, savedPasswordRejected, onSubmit, onCancel }: PasswordPromptProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (usernameRequired && !username.trim()) {
      setError("Username is required");
      return;
    }
    onSubmit({ username: usernameRequired ? username.trim() : null, password, remember });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onCancel()}
      title={`Log in to ${hostLabel}`}
      description={savedPasswordRejected ? "The saved password was rejected. Enter the current one." : undefined}
    >
      <form onSubmit={submit} className="flex flex-col gap-3">
        {usernameRequired && (
          <Field label="Username" error={error ?? undefined}>
            <Input aria-label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          </Field>
        )}
        <Field label="Password">
          <Input
            aria-label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus={!usernameRequired}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember in vault (encrypted)
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Connect
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
