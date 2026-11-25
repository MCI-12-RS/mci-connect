// E2.03 (UX-38, "Textos"): o módulo único dos textos de senha.
import { describe, expect, it } from "vitest";
import {
  FORCED_CHANGE_TEXTS,
  INITIAL_PASSWORD_TEXTS,
  LOGIN_PASSWORD_TEXTS,
  OWN_CHANGE_TEXTS,
  PASSWORD_CHANGE_TEXTS,
  PASSWORD_ROW_TEXTS,
  RESET_TEXTS,
  REVEAL_LABELS,
  changeBlockedMessage,
  changeErrorMessage,
  initialPasswordErrorMessage,
  resetRefusalMessage,
} from "./password-texts";

function allTexts(): string[] {
  const out: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === "string") out.push(value);
    else if (typeof value === "function") visit(value.length === 1 && value === RESET_TEXTS.spelled ? value(["k", "7"]) : value("Caio Lima", "M"));
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  [FORCED_CHANGE_TEXTS, INITIAL_PASSWORD_TEXTS, LOGIN_PASSWORD_TEXTS, OWN_CHANGE_TEXTS, PASSWORD_CHANGE_TEXTS, PASSWORD_ROW_TEXTS, RESET_TEXTS, REVEAL_LABELS].forEach(visit);
  for (const code of ["password_too_short", "password_too_long", "password_weak", "password_personal_data", "password_same_as_current", "password_mismatch"] as const) {
    out.push(changeErrorMessage(code));
  }
  for (const code of ["password_too_short", "password_too_long", "password_weak", "password_personal_data"] as const) {
    out.push(initialPasswordErrorMessage(code));
  }
  for (const code of ["no_permission", "rate_limited", "not_found", "self", "role_not_covered", "no_account"] as const) {
    out.push(resetRefusalMessage(code, 3));
  }
  out.push(changeBlockedMessage(15));
  return out;
}

describe("UX-38: textos sem os termos proibidos", () => {
  it.each([/resetar/i, /\breset\b/i, /password/i, /Alterar Senha/, /\bPIN\b/, /token/i])("sem %s", (pattern) => {
    for (const text of allTexts()) expect(text).not.toMatch(pattern);
  });
});

describe("plural e tom", () => {
  it("'1 minuto' no singular (RN-06, RN-12)", () => {
    expect(changeBlockedMessage(1)).toBe("Muitas tentativas sem sucesso. Aguarde 1 minuto e tente de novo.");
    expect(resetRefusalMessage("rate_limited", 1)).toContain("Aguarde 1 minuto e");
    expect(resetRefusalMessage("rate_limited", 8)).toContain("Aguarde 8 minutos e");
  });

  it("confirmação com o primeiro nome e o gênero (P-SEN-25)", () => {
    expect(RESET_TEXTS.confirmTopics("Caio Lima", "M")[1]).toBe("Se Caio estiver conectado, terá que entrar de novo.");
    expect(RESET_TEXTS.confirmTopics("Vera Nunes", "F")[1]).toBe("Se Vera estiver conectada, terá que entrar de novo.");
    expect(RESET_TEXTS.confirmTopics("Lia", null)[1]).toBe("Se Lia estiver conectado, terá que entrar de novo.");
  });

  it("a senha inicial fala do membro, não de quem cadastra (P-SEN-21)", () => {
    expect(initialPasswordErrorMessage("password_personal_data")).toBe(
      "A senha não pode conter o CPF, o celular ou a data de nascimento do membro, nem ser o e-mail do cadastro.",
    );
    expect(changeErrorMessage("password_personal_data")).toContain("o seu CPF");
  });
});
