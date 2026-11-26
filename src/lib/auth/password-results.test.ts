// E2.03 ("Contratos", AQ-1, AQ-4): a leitura das respostas da troca e da redefinição.
import { describe, expect, it } from "vitest";
import { fieldForCode, parseChangePasswordResponse, parseResetResult } from "./password-results";

describe("parseChangePasswordResponse", () => {
  it("cada status do contrato com o seu result", () => {
    expect(parseChangePasswordResponse(200, { result: "ok" })).toEqual({ result: "ok", replayed: false });
    expect(parseChangePasswordResponse(200, { result: "ok", replayed: true })).toEqual({ result: "ok", replayed: true });
    expect(parseChangePasswordResponse(400, { result: "empty_fields" })).toEqual({ result: "empty_fields" });
    expect(parseChangePasswordResponse(400, { result: "invalid", code: "password_weak", field: "new_password" })).toEqual({
      result: "invalid",
      code: "password_weak",
    });
    expect(parseChangePasswordResponse(400, { result: "invalid", code: "password_mismatch", field: "confirmation" })).toEqual({
      result: "invalid",
      code: "password_mismatch",
    });
    expect(parseChangePasswordResponse(401, { result: "session_ended" })).toEqual({ result: "session_ended" });
    expect(parseChangePasswordResponse(403, { result: "not_flagged" })).toEqual({ result: "not_flagged" });
    expect(parseChangePasswordResponse(403, { result: "forbidden" })).toEqual({ result: "forbidden" });
    expect(parseChangePasswordResponse(422, { result: "current_password_invalid" })).toEqual({ result: "current_password_invalid" });
    expect(parseChangePasswordResponse(429, { result: "change_blocked", retry_after_minutes: 1 })).toEqual({
      result: "change_blocked",
      minutes: 1,
    });
  });

  it("fora do contrato vira server_error (UX-09: nenhum texto do servidor como veio)", () => {
    const serverError = { result: "server_error" };
    expect(parseChangePasswordResponse(500, { result: "server_error" })).toEqual(serverError);
    expect(parseChangePasswordResponse(200, null)).toEqual(serverError);
    expect(parseChangePasswordResponse(200, { result: "invalid" })).toEqual(serverError);
    expect(parseChangePasswordResponse(400, { result: "invalid", code: "password_weak", field: "confirmation" })).toEqual(serverError);
    expect(parseChangePasswordResponse(400, { result: "invalid", code: "outro", field: "new_password" })).toEqual(serverError);
    expect(parseChangePasswordResponse(429, { result: "change_blocked", retry_after_minutes: 0 })).toEqual(serverError);
    expect(parseChangePasswordResponse(429, { result: "change_blocked" })).toEqual(serverError);
  });

  it("fieldForCode põe cada mensagem no seu campo (AQ-4)", () => {
    expect(fieldForCode("current_password_invalid")).toBe("current_password");
    expect(fieldForCode("password_mismatch")).toBe("confirmation");
    expect(fieldForCode("password_same_as_current")).toBe("new_password");
    expect(fieldForCode("password_too_long")).toBe("new_password");
  });
});

describe("parseResetResult", () => {
  const ok = { result: "ok", password: "k7m2x9pa", expires_at: "2026-12-06T02:50:00+00:00", reset_at: "2026-11-29T02:50:00+00:00" };

  it("ok com a senha e as datas", () => {
    expect(parseResetResult(ok)).toEqual({
      result: "ok",
      password: "k7m2x9pa",
      expiresAt: ok.expires_at,
      resetAt: ok.reset_at,
    });
  });

  it("recusas com o código; o limite com os minutos", () => {
    for (const code of ["no_permission", "not_found", "self", "role_not_covered", "no_account"]) {
      expect(parseResetResult({ result: "refused", code, message: "texto do servidor" })).toEqual({ result: "refused", code });
    }
    expect(parseResetResult({ result: "refused", code: "rate_limited", retry_after_minutes: 8 })).toEqual({
      result: "refused",
      code: "rate_limited",
      minutes: 8,
    });
  });

  it("fora do contrato vira server_error, sem a senha", () => {
    expect(parseResetResult(null)).toEqual({ result: "server_error" });
    expect(parseResetResult({ ...ok, password: "K7M2X9PA" })).toEqual({ result: "server_error" });
    expect(parseResetResult({ ...ok, expires_at: "ontem" })).toEqual({ result: "server_error" });
    expect(parseResetResult({ result: "refused", code: "outro" })).toEqual({ result: "server_error" });
  });
});
