import { describe, it, expect } from "vitest";
import {
  APP_ERROR_HINT,
  PERMISSION_DENIED,
  isNetworkError,
  isPermissionDenied,
  parseAppError,
  retryOnceOnNetworkError,
  retryUnlessPermissionDenied,
  toAppError,
} from "./errors";

const denied = { code: PERMISSION_DENIED, message: "Você não tem permissão para ver o dashboard." };
const otherError = { code: "PGRST116", message: "" };

describe("isPermissionDenied", () => {
  it("Dado um erro do banco com o código 42501, então é permissão negada", () => {
    expect(isPermissionDenied(denied)).toBe(true);
    expect(isPermissionDenied(Object.assign(new Error("x"), { code: "42501" }))).toBe(true);
  });

  it("Dado outro código, outro tipo de valor ou nenhum código, então não é permissão negada", () => {
    expect(isPermissionDenied(otherError)).toBe(false);
    expect(isPermissionDenied({ code: 42501 })).toBe(false);
    expect(isPermissionDenied(new Error("42501"))).toBe(false);
    expect(isPermissionDenied("42501")).toBe(false);
    expect(isPermissionDenied(null)).toBe(false);
    expect(isPermissionDenied(undefined)).toBe(false);
  });
});

describe("retryUnlessPermissionDenied", () => {
  it("Dada uma permissão negada, então não tenta de novo", () => {
    expect(retryUnlessPermissionDenied(0, denied)).toBe(false);
  });

  it("Dado outro erro, então tenta de novo até 3 vezes, como o padrão do TanStack Query", () => {
    expect([0, 1, 2, 3].map((failures) => retryUnlessPermissionDenied(failures, otherError))).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });
});

// Erros de regra do banco (E2.01, "Formato dos erros", AQ-2): 22023, a
// mensagem pronta e os detalhes em JSON, como o PostgREST os devolve.
describe("parseAppError", () => {
  const appError = (details: unknown, message = "Você não pode excluir o seu próprio cadastro.") => ({
    code: "22023",
    message,
    details,
    hint: APP_ERROR_HINT,
  });

  it("Dado um erro app_error com detalhes, então devolve o código, a mensagem e os detalhes", () => {
    const details = JSON.stringify({ code: "not_found_or_deleted", entity: "member" });
    expect(parseAppError(appError(details, "Este cadastro não existe ou já foi excluído."))).toEqual({
      code: "not_found_or_deleted",
      message: "Este cadastro não existe ou já foi excluído.",
      detail: { code: "not_found_or_deleted", entity: "member" },
    });
  });

  it("Dado o bloqueio por ligações, então os detalhes trazem as listas como vieram", () => {
    const detail = {
      code: "member_has_links",
      member_id: "g1",
      member_name: "Gil",
      disciples_total: 1,
      disciples: [{ id: "h1", name: "Hugo", is_active: true }],
      cells_total: 0,
      cells: [],
    };
    expect(parseAppError(appError(JSON.stringify(detail), "Não é possível excluir Gil."))?.detail).toEqual(detail);
  });

  it("Dado um app_error sem detalhes válidos, então volta com o código vazio e a mensagem como veio (UX-11)", () => {
    for (const details of [null, undefined, "", "não é JSON", "[1,2]", JSON.stringify({ entity: "member" }), "{\"code\": 7}"]) {
      expect(parseAppError(appError(details))).toEqual({
        code: "",
        message: "Você não pode excluir o seu próprio cadastro.",
        detail: {},
      });
    }
  });

  it("Dado outro erro (permissão, rede, técnico, sem hint ou sem mensagem), então não é erro de regra", () => {
    expect(parseAppError(denied)).toBeNull();
    expect(parseAppError({ code: "22023", message: "x", details: "{\"code\":\"self_delete\"}", hint: null })).toBeNull();
    expect(parseAppError({ code: "22023", message: null, details: "{\"code\":\"self_delete\"}", hint: APP_ERROR_HINT })).toBeNull();
    expect(parseAppError({ code: "", message: "TypeError: Failed to fetch", details: "", hint: "" })).toBeNull();
    expect(parseAppError(new Error("app_error"))).toBeNull();
    expect(parseAppError("app_error")).toBeNull();
    expect(parseAppError(null)).toBeNull();
  });
});

describe("toAppError (recusa já em JSON, como a da pré-checagem)", () => {
  it("Dado { code, message, … }, então devolve a recusa com o objeto inteiro nos detalhes", () => {
    const value = { can_delete: false, code: "role_above", message: "Você não tem permissão para excluir este membro." };
    expect(toAppError(value)).toEqual({ code: "role_above", message: value.message, detail: value });
  });

  it("Dado um objeto sem código, com código vazio ou sem mensagem, então devolve null", () => {
    expect(toAppError({ message: "x" })).toBeNull();
    expect(toAppError({ code: "", message: "x" })).toBeNull();
    expect(toAppError({ code: "self_delete" })).toBeNull();
    expect(toAppError([{ code: "self_delete", message: "x" }])).toBeNull();
    expect(toAppError(null)).toBeNull();
  });
});

describe("isNetworkError", () => {
  it("Dada a falha do fetch como o supabase-js a devolve (sem código), então é queda de conexão", () => {
    expect(isNetworkError({ code: "", message: "TypeError: Failed to fetch", details: "", hint: "" })).toBe(true);
    expect(isNetworkError({ code: "", message: "TypeError: Load failed", details: "", hint: "" })).toBe(true);
    expect(isNetworkError({ code: "", message: "FetchError: request failed", details: "", hint: "" })).toBe(true);
    expect(isNetworkError({ code: "", message: "AbortError: signal is aborted without reason", details: "", hint: "" })).toBe(true);
  });

  it("Dada a falha de rede de uma Edge Function, então é queda de conexão", () => {
    const error = new Error("Failed to send a request to the Edge Function");
    error.name = "FunctionsFetchError";
    expect(isNetworkError(error)).toBe(true);
  });

  it("Dada uma resposta do servidor (permissão, regra, 5xx, erro técnico), então não é queda de conexão", () => {
    expect(isNetworkError(denied)).toBe(false);
    expect(isNetworkError({ code: "22023", message: "Este cadastro não existe ou já foi excluído.", hint: APP_ERROR_HINT })).toBe(false);
    expect(isNetworkError({ code: "40P01", message: "deadlock detected" })).toBe(false);
    expect(isNetworkError({ message: "<html>502 Bad Gateway</html>" })).toBe(false);
    expect(isNetworkError({ code: "", message: "Failed to fetch" })).toBe(false);
    expect(isNetworkError(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(isNetworkError(null)).toBe(false);
    expect(isNetworkError("TypeError: Failed to fetch")).toBe(false);
  });
});

describe("retryOnceOnNetworkError", () => {
  const offline = { code: "", message: "TypeError: Failed to fetch", details: "", hint: "" };

  it("Dada uma queda de conexão, então tenta de novo uma vez só", () => {
    expect([0, 1, 2].map((failures) => retryOnceOnNetworkError(failures, offline))).toEqual([true, false, false]);
  });

  it("Dada uma resposta de erro do servidor, então não tenta de novo", () => {
    expect(retryOnceOnNetworkError(0, denied)).toBe(false);
    expect(retryOnceOnNetworkError(0, otherError)).toBe(false);
    expect(retryOnceOnNetworkError(0, { code: "XX000", message: "falhou" })).toBe(false);
    expect(retryOnceOnNetworkError(0, { message: "<html>502 Bad Gateway</html>" })).toBe(false);
  });
});
