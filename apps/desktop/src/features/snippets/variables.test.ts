import { describe, expect, it } from "vitest";

import { fillVariables, parseVariables } from "./variables";

describe("snippet variables", () => {
  it("finds variables with and without defaults, once each, in order", () => {
    expect(parseVariables("tail -n {{ lines:200 }} {{file}} | grep {{pattern}} {{file:/tmp/x}}")).toEqual([
      { name: "lines", defaultValue: "200" },
      { name: "file", defaultValue: "" },
      { name: "pattern", defaultValue: "" },
    ]);
  });

  it("ignores things that only look like variables", () => {
    expect(parseVariables("echo {{}} {{1abc}} { {x} } ${HOME} {{ok_name-2}}")).toEqual([{ name: "ok_name-2", defaultValue: "" }]);
  });

  it("allows colons and spaces in defaults", () => {
    expect(parseVariables("curl {{url:http://localhost:8080/health check}}")).toEqual([{ name: "url", defaultValue: "http://localhost:8080/health check" }]);
  });

  it("fills every occurrence and falls back to defaults", () => {
    const command = "scp {{file}} {{host:backup}}:/srv/{{file}} && echo {{host}}";
    expect(fillVariables(command, { file: "db.sql" })).toBe("scp db.sql backup:/srv/db.sql && echo ");
    expect(fillVariables(command, { file: "a", host: "b" })).toBe("scp a b:/srv/a && echo b");
    expect(fillVariables("ls {{dir:.}}", { dir: "" })).toBe("ls .");
  });

  it("leaves commands without variables untouched", () => {
    expect(fillVariables("docker ps -a", {})).toBe("docker ps -a");
  });
});
