import { describe, expect, it } from "vitest";
import { isSignInLocked, isSignInOk, isSignInSession, parseSignInResponse } from "./sign-in-result";

const session = {
  access_token: "a",
  refresh_token: "r",
  expires_in: 3600,
  expires_at: 1_900_000_000,
  token_type: "bearer",
};

describe("parseSignInResponse (contrato da sign-in)", () => {
  it("200 ok com a sessão, só com os campos do contrato", () => {
    const parsed = parseSignInResponse(200, { result: "ok", session: { ...session, user: { email: "x" } } });
    expect(parsed).toEqual({ result: "ok", session, mustChangePassword: false });
    expect(isSignInOk(parsed)).toBe(true);
  });

  it("E2.03 (RN-08 b): o 200 traz a marca de troca obrigatória; fora do tipo, server_error", () => {
    expect(parseSignInResponse(200, { result: "ok", session, must_change_password: true })).toEqual({
      result: "ok",
      session,
      mustChangePassword: true,
    });
    expect(parseSignInResponse(200, { result: "ok", session, must_change_password: false })).toEqual({
      result: "ok",
      session,
      mustChangePassword: false,
    });
    expect(parseSignInResponse(200, { result: "ok", session, must_change_password: "true" })).toEqual({
      result: "server_error",
    });
    expect(parseSignInResponse(200, { result: "ok", session, must_change_password: null })).toEqual({
      result: "server_error",
    });
  });

  it("200 sem sessão válida é server_error", () => {
    expect(parseSignInResponse(200, { result: "ok" })).toEqual({ result: "server_error" });
    expect(parseSignInResponse(200, { result: "ok", session: { ...session, refresh_token: "" } })).toEqual({
      result: "server_error",
    });
  });

  it("400, 401 e 429 do contrato", () => {
    expect(parseSignInResponse(400, { result: "empty_fields" })).toEqual({ result: "empty_fields" });
    expect(parseSignInResponse(401, { result: "invalid_credentials" })).toEqual({ result: "invalid_credentials" });
    const locked = parseSignInResponse(429, { result: "locked", retry_after_minutes: 15 });
    expect(locked).toEqual({ result: "locked", minutes: 15 });
    expect(isSignInLocked(locked)).toBe(true);
  });

  it.each([
    [429, { result: "locked" }],
    [429, { result: "locked", retry_after_minutes: 0 }],
    [429, { result: "locked", retry_after_minutes: 1.5 }],
    [429, { result: "locked", retry_after_minutes: "15" }],
    [401, { result: "empty_fields" }],
    [400, { result: "invalid_credentials" }],
    [200, { result: "invalid_credentials" }],
    [500, { result: "server_error" }],
    [502, null],
    [405, { result: "server_error" }],
    [413, { result: "server_error" }],
    [401, null],
    [401, "invalid_credentials"],
    [401, [{ result: "invalid_credentials" }]],
    [418, { result: "ok", session }],
  ])("fora do contrato vira server_error: %s %j", (status, body) => {
    expect(parseSignInResponse(status, body)).toEqual({ result: "server_error" });
  });
});

describe("isSignInSession", () => {
  it("exige os cinco campos com o tipo certo", () => {
    expect(isSignInSession(session)).toBe(true);
    expect(isSignInSession({ ...session, expires_at: "1" })).toBe(false);
    expect(isSignInSession(null)).toBe(false);
  });
});
