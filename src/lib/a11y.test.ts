import { describe, expect, it } from "vitest";
import { describedBy, fieldA11yProps, fieldMessageIds } from "./a11y";

describe("describedBy", () => {
  it("junta os ids sem os vazios", () => {
    expect(describedBy("a", null, false, undefined, "b")).toBe("a b");
    expect(describedBy(null, "")).toBeUndefined();
  });
});

describe("fieldMessageIds (P21)", () => {
  it("erro, aviso e dica, nessa ordem, só os que existem", () => {
    expect(fieldMessageIds("name", { hint: "h", error: "e", warning: "w" })).toBe("name-error name-warning name-hint");
    expect(fieldMessageIds("name", { warning: "w" })).toBe("name-warning");
    expect(fieldMessageIds("name", { error: null, hint: "" })).toBeUndefined();
  });
});

describe("fieldA11yProps (P21)", () => {
  it("o erro do campo ou do grupo marca aria-invalid; as mensagens do grupo vêm depois das do campo", () => {
    expect(fieldA11yProps("email", { error: "e" })).toEqual({ "aria-invalid": true, "aria-describedby": "email-error" });
    expect(fieldA11yProps("email", {}, { ids: "identification-error", invalid: true })).toEqual({
      "aria-invalid": true,
      "aria-describedby": "identification-error",
    });
    expect(fieldA11yProps("cpf", { warning: "w" }, { ids: "identification-hint" })).toEqual({
      "aria-invalid": undefined,
      "aria-describedby": "cpf-warning identification-hint",
    });
  });
});
