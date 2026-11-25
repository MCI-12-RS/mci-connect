import { describe, expect, it } from "vitest";
import {
  AUTH_ACTION_LABELS,
  authEventDetailFields,
  authEventSecondLine,
  isAuthEventMetadata,
  readAuthEventMetadata,
  type AuthEventLike,
} from "./auth-events";

const event = (over: Partial<AuthEventLike>): AuthEventLike => ({
  action: "login_failed",
  entity: "auth",
  entity_label: null,
  error_reason: null,
  metadata: null,
  ...over,
});

describe("AUTH_ACTION_LABELS (UX-15)", () => {
  it("tem Login (bloqueio) entre Login (falha) e Logout", () => {
    expect(Object.values(AUTH_ACTION_LABELS)).toEqual(["Login", "Login (falha)", "Login (bloqueio)", "Logout"]);
  });
});

describe("metadata", () => {
  it("o type guard aceita só as chaves conhecidas com o tipo certo", () => {
    expect(isAuthEventMetadata({ reason: "wrong_password", identifier_type: "email", identifier_masked: "a***@x.com" })).toBe(true);
    expect(isAuthEventMetadata({ block_scope: "origin", block_minutes: 15 })).toBe(true);
    expect(isAuthEventMetadata({ reason: "outro" })).toBe(false);
    expect(isAuthEventMetadata({ block_minutes: "15" })).toBe(false);
    expect(isAuthEventMetadata([])).toBe(false);
    expect(isAuthEventMetadata(null)).toBe(false);
  });

  it("a leitura descarta o que não tem o tipo esperado", () => {
    expect(
      readAuthEventMetadata({ reason: "x", identifier_type: "cpf_or_mobile", block_scope: "ip", block_minutes: 15, origin: "1.2.3.4" }),
    ).toEqual({ identifier_type: "cpf_or_mobile", block_minutes: 15 });
    expect(readAuthEventMetadata("texto")).toEqual({});
  });
});

describe("authEventSecondLine (UX-16)", () => {
  it("falha: motivo e cadastro", () => {
    expect(
      authEventSecondLine(event({ entity_label: "Ana Souza", metadata: { reason: "wrong_password", identifier_type: "email" } })),
    ).toBe("Senha incorreta · Ana Souza");
    expect(authEventSecondLine(event({ metadata: { reason: "not_found" } }))).toBe("Identificação não encontrada");
  });

  it("falha sem reason conhecido usa o error_reason", () => {
    expect(authEventSecondLine(event({ error_reason: "Identificação ambígua", metadata: {} }))).toBe("Identificação ambígua");
  });

  it("bloqueio: tipo e duração, com 1 minuto no singular, e o cadastro quando ligado", () => {
    expect(
      authEventSecondLine(event({ action: "login_blocked", metadata: { block_scope: "origin", block_minutes: 15 } })),
    ).toBe("Por origem · 15 minutos");
    expect(
      authEventSecondLine(
        event({ action: "login_blocked", entity_label: "Ana Souza", metadata: { block_scope: "identifier", block_minutes: 1 } }),
      ),
    ).toBe("Por identificação · 1 minuto · Ana Souza");
  });

  it("login, logout e eventos de outras entidades: nada", () => {
    expect(authEventSecondLine(event({ action: "login", entity_label: "Ana" }))).toBeNull();
    expect(authEventSecondLine(event({ action: "logout" }))).toBeNull();
    expect(authEventSecondLine(event({ entity: "member", metadata: { reason: "wrong_password" } }))).toBeNull();
  });
});

describe("authEventDetailFields (UX-17)", () => {
  it("falha: Motivo, Cadastro, Tipo de identificação e Identificação", () => {
    const fields = authEventDetailFields(
      event({
        entity_label: "Ana Souza",
        error_reason: "Senha incorreta",
        metadata: { reason: "wrong_password", identifier_type: "email", identifier_masked: "a***@exemplo.com" },
      }),
    );
    expect(fields.map((f) => [f.label, f.value])).toEqual([
      ["Motivo", "Senha incorreta"],
      ["Cadastro", "Ana Souza"],
      ["Tipo de identificação", "E-mail"],
      ["Identificação", "a***@exemplo.com"],
    ]);
  });

  it("identificação inválida: só ***, sem tipo", () => {
    const fields = authEventDetailFields(
      event({ metadata: { reason: "invalid_identifier", identifier_masked: "***" } }),
    );
    expect(fields.map((f) => [f.label, f.value])).toEqual([
      ["Motivo", "Identificação inválida"],
      ["Identificação", "***"],
    ]);
  });

  it("bloqueio por origem: só tipo e duração; a origem nunca aparece", () => {
    const fields = authEventDetailFields(
      event({ action: "login_blocked", metadata: { block_scope: "origin", block_minutes: 15, origin: "1.2.3.4" } }),
    );
    expect(fields.map((f) => [f.label, f.value])).toEqual([
      ["Tipo de bloqueio", "Por origem"],
      ["Duração", "15 minutos"],
    ]);
  });

  it("bloqueio por identificação: tipo, duração, tipo e identificação", () => {
    const fields = authEventDetailFields(
      event({
        action: "login_blocked",
        metadata: { block_scope: "identifier", block_minutes: 15, identifier_type: "mobile", identifier_masked: "***7777" },
      }),
    );
    expect(fields.map((f) => f.label)).toEqual(["Tipo de bloqueio", "Duração", "Tipo de identificação", "Identificação"]);
  });

  it("login antigo, sem cadastro ligado: só a identificação mascarada", () => {
    const fields = authEventDetailFields(event({ action: "login", metadata: { identifier_masked: "a***@x.com" } }));
    expect(fields.map((f) => f.label)).toEqual(["Identificação"]);
  });
});
