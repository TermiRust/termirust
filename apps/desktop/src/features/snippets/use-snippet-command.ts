import { useEffect, useState } from "react";

import { commands, type SnippetView } from "@/bindings";

import { fillVariables, parseVariables } from "./variables";

/** Variable values, the resulting command and its danger check, shared by the run dialogs. */
export function useSnippetCommand(snippet: SnippetView) {
  const variables = parseVariables(snippet.command);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(variables.map((v) => [v.name, v.defaultValue])));
  const [danger, setDanger] = useState<{ command: string; reason: string | null } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const command = fillVariables(snippet.command, values);

  useEffect(() => {
    let current = true;
    void commands.commandDanger(command).then((reason) => current && setDanger({ command, reason }));
    return () => {
      current = false;
    };
  }, [command]);

  const reason = danger?.command === command ? danger.reason : null;
  return {
    variables,
    values,
    setValue: (name: string, value: string) => {
      setConfirmed(false);
      setValues((current) => ({ ...current, [name]: value }));
    },
    command,
    missing: variables.filter((v) => !values[v.name]?.trim()).map((v) => v.name),
    reason,
    confirmed,
    setConfirmed,
    /** Running is blocked until a flagged command is confirmed. */
    blocked: Boolean(reason) && !confirmed,
  };
}

export type SnippetCommand = ReturnType<typeof useSnippetCommand>;
