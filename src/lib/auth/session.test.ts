import { describe, expect, it } from "vitest";
import {
  IDENTIFIER_TYPE_LABELS,
  LOGIN_TEXTS,
  SESSION_ENDED_REASON,
  isSessionEndedState,
  lockedMessage,
  loginNoticeText,
  noticeForOutcome,
  shouldEndSession,
  type LoginNotice,
} from "./session";
import { isNetworkError } from "@/lib/errors";

const ALL_NOTICES: LoginNotice[] = [
  { kind: "session_ended" },
  { kind: "empty_fields" },
  { kind: "invalid_format" },
  { kind: "invalid_credentials" },
  { kind: "locked", minutes: 15 },
  { kind: "locked", minutes: 1 },
  { kind: "connection" },
];

describe("lockedMessage (RN-12)", () => {
  it("usa {N} minutos, com 1 minuto no singular", () => {
    expect(lockedMessage(15)).toBe(
      "Muitas tentativas sem sucesso. Aguarde 15 minutos e tente de novo. Se esqueceu a senha, fale com o seu líder.",
    );
    expect(lockedMessage(1)).toContain("Aguarde 1 minuto e tente");
    expect(lockedMessage(2)).toContain("Aguarde 2 minutos e tente");
  });
});

describe("textos do login (UX-09)", () => {
  const texts = [
    ...Object.values(LOGIN_TEXTS),
    ...Object.values(IDENTIFIER_TYPE_LABELS),
    ...ALL_NOTICES.map(loginNoticeText),
  ];
  it.each(["bloquead", "suspens", "não encontrad", "senha incorreta", "invalid", "password", "error"])(
    "nenhum texto contém %s",
    (word) => {
      for (const text of texts) expect(text.toLowerCase()).not.toContain(word);
    },
  );

  it("textos da falha, da conexão e dos campos vazios são os do spec", () => {
    expect(loginNoticeText({ kind: "invalid_credentials" })).toBe(
      "Usuário ou senha inválidos. Confira os dados e tente de novo.",
    );
    expect(loginNoticeText({ kind: "connection" })).toBe(
      "Não foi possível entrar. Verifique a conexão e tente de novo.",
    );
    expect(loginNoticeText({ kind: "empty_fields" })).toBe("Informe a identificação e a senha.");
    expect(loginNoticeText({ kind: "invalid_format" })).toBe(
      "Confira a identificação: use o CPF, o celular com DDD ou o e-mail.",
    );
    expect(loginNoticeText({ kind: "session_ended" })).toBe("Sua sessão terminou. Entre de novo para continuar.");
  });
});

describe("noticeForOutcome", () => {
  it("traduz cada resultado da sign-in na mensagem da tela", () => {
    expect(noticeForOutcome({ result: "ok" })).toBeNull();
    expect(noticeForOutcome({ result: "invalid_credentials" })).toEqual({ kind: "invalid_credentials" });
    expect(noticeForOutcome({ result: "locked", minutes: 7 })).toEqual({ kind: "locked", minutes: 7 });
    expect(noticeForOutcome({ result: "empty_fields" })).toEqual({ kind: "empty_fields" });
    expect(noticeForOutcome({ result: "server_error" })).toEqual({ kind: "connection" });
  });
});

describe("isSessionEndedState (contrato com o PR 6 do E2.01)", () => {
  it("só com state.reason === 'session_ended'", () => {
    expect(SESSION_ENDED_REASON).toBe("session_ended");
    expect(isSessionEndedState({ reason: "session_ended" })).toBe(true);
    expect(isSessionEndedState({ reason: "other" })).toBe(false);
    expect(isSessionEndedState({ returnTo: "/cells" })).toBe(false);
    expect(isSessionEndedState(null)).toBe(false);
    expect(isSessionEndedState(undefined)).toBe(false);
    expect(isSessionEndedState("session_ended")).toBe(false);
  });
});

describe("shouldEndSession (E2.01, RN-14 e DT-20)", () => {
  it("encerra só quando a releitura volta sem erro e sem linha", () => {
    expect(shouldEndSession({ data: null, error: null })).toBe(true);
  });

  it("mantém a sessão quando o cadastro voltou", () => {
    expect(shouldEndSession({ data: { id: "m1" }, error: null })).toBe(false);
  });

  it("mantém a sessão na queda de conexão", () => {
    const error = { code: "", message: "TypeError: Failed to fetch", details: "", hint: "" };
    expect(isNetworkError(error)).toBe(true);
    expect(shouldEndSession({ data: null, error })).toBe(false);
  });

  it.each([
    ["5xx", { code: "", message: "Internal Server Error", details: "", hint: "" }],
    ["tempo esgotado", { code: "", message: "AbortError: signal is aborted", details: "", hint: "" }],
    ["JWT recusado (401)", { code: "PGRST301", message: "JWT expired", details: "", hint: "" }],
    ["42501", { code: "42501", message: "permission denied", details: "", hint: "" }],
    ["mais de uma linha", { code: "PGRST116", message: "multiple rows", details: "", hint: "" }],
  ])("mantém a sessão com qualquer erro: %s", (_label, error) => {
    expect(shouldEndSession({ data: null, error })).toBe(false);
  });
});
