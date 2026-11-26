// E2.03 (T5, UX-21, UX-39, AQ-2): a linha "Senha" e a ação da lista.
import { describe, expect, it } from "vitest";
import { canResetFromList, passwordRowView, type PasswordRowInput } from "./password-row";

const base: PasswordRowInput = { isSelf: false, accessLoaded: true, canReset: true, status: "allowed", hasAccount: true };

describe("passwordRowView", () => {
  it("UX-21 e UX-15: cada situação da tabela da T5", () => {
    expect(passwordRowView(base)).toEqual({ kind: "reset" });
    expect(passwordRowView({ ...base, status: "no_account", hasAccount: false })).toEqual({ kind: "no_account" });
    expect(passwordRowView({ ...base, status: "role_not_covered" })).toEqual({ kind: "role_not_covered" });
    expect(passwordRowView({ ...base, canReset: false, status: null })).toEqual({ kind: "hidden" });
    expect(passwordRowView({ ...base, isSelf: true, canReset: false, status: null })).toEqual({ kind: "change_own" });
    expect(passwordRowView({ ...base, status: "self" })).toEqual({ kind: "change_own" });
  });

  it("carregando enquanto o acesso não chegou; a recusa desta abertura vale mais que a linha", () => {
    expect(passwordRowView({ ...base, accessLoaded: false })).toEqual({ kind: "loading" });
    expect(passwordRowView({ ...base, refusal: "role_not_covered" })).toEqual({ kind: "role_not_covered" });
  });

  it("sem a coluna (padrão da AQ-2): o botão para quem tem conta, o texto para quem não tem", () => {
    expect(passwordRowView({ ...base, status: undefined })).toEqual({ kind: "reset" });
    expect(passwordRowView({ ...base, status: undefined, hasAccount: false })).toEqual({ kind: "no_account" });
  });
});

describe("canResetFromList (UX-39)", () => {
  it("só `allowed`", () => {
    expect(canResetFromList("allowed")).toBe(true);
    for (const status of ["self", "role_not_covered", "no_account", null, undefined]) expect(canResetFromList(status)).toBe(false);
  });
});
