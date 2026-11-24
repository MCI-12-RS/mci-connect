import { describe, it, expect } from "vitest";
import { APP_ERROR_HINT } from "@/lib/errors";
import { classifyWriteError, parseDeletionCheck } from "./outcome";

// O que a tela faz com a resposta de uma exclusão (E2.01, "Estados", UX-11,
// UX-24 e UX-39) e com a pré-checagem (AQ-1, DT-11).

const appError = (code: string, message: string, extra: object = {}) => ({
  code: "22023",
  message,
  details: JSON.stringify({ code, ...extra }),
  hint: APP_ERROR_HINT,
});

describe("classifyWriteError", () => {
  it("Dado 'não existe ou já foi excluído', então o registro sumiu, com a mensagem do servidor (UX-24)", () => {
    expect(
      classifyWriteError(appError("not_found_or_deleted", "Este cadastro não existe ou já foi excluído.", { entity: "member" })),
    ).toEqual({ kind: "gone", message: "Este cadastro não existe ou já foi excluído." });
  });

  it("Dada uma recusa de regra, então vai para o bloqueio com a recusa inteira (UX-11)", () => {
    expect(classifyWriteError(appError("self_delete", "Você não pode excluir o seu próprio cadastro."))).toEqual({
      kind: "refused",
      refusal: {
        code: "self_delete",
        message: "Você não pode excluir o seu próprio cadastro.",
        detail: { code: "self_delete" },
      },
    });
  });

  it("Dado um app_error sem detalhes, então também é recusa, com a mensagem como veio", () => {
    const result = classifyWriteError({ code: "22023", message: "Mensagem do servidor.", details: null, hint: APP_ERROR_HINT });
    expect(result).toEqual({ kind: "refused", refusal: { code: "", message: "Mensagem do servidor.", detail: {} } });
  });

  it("Dado 42501, então é falta de permissão (UX-39)", () => {
    expect(classifyWriteError({ code: "42501", message: "Você não tem permissão para esta ação." })).toEqual({
      kind: "forbidden",
    });
  });

  it("Dada a falha do fetch, então é queda de conexão", () => {
    expect(classifyWriteError({ code: "", message: "TypeError: Failed to fetch", details: "", hint: "" })).toEqual({
      kind: "network",
    });
  });

  it("Dado um erro técnico (deadlock, 5xx), então pede para tentar de novo, sem a mensagem técnica", () => {
    expect(classifyWriteError({ code: "40P01", message: "deadlock detected" })).toEqual({ kind: "unexpected" });
    expect(classifyWriteError({ message: "<html>502</html>" })).toEqual({ kind: "unexpected" });
    expect(classifyWriteError(undefined)).toEqual({ kind: "unexpected" });
  });
});

describe("parseDeletionCheck", () => {
  it("Dado { can_delete: true }, então pode excluir", () => {
    expect(parseDeletionCheck({ can_delete: true })).toEqual({ canDelete: true });
  });

  it("Dada a recusa por ligações, então devolve a mesma recusa que a exclusão devolveria (DT-11)", () => {
    const value = {
      can_delete: false,
      code: "member_has_links",
      message: "Não é possível excluir Gil. Antes, reatribua 1 discípulo.",
      member_id: "g1",
      member_name: "Gil",
      disciples_total: 1,
      disciples: [{ id: "h1", name: "Hugo", is_active: true }],
      cells_total: 0,
      cells: [],
    };
    expect(parseDeletionCheck(value)).toEqual({
      canDelete: false,
      failure: { kind: "refused", refusal: { code: "member_has_links", message: value.message, detail: value } },
    });
  });

  it("Dado 'não existe ou já foi excluído', então o cadastro sumiu", () => {
    expect(
      parseDeletionCheck({
        can_delete: false,
        code: "not_found_or_deleted",
        message: "Este cadastro não existe ou já foi excluído.",
        entity: "member",
      }),
    ).toEqual({ canDelete: false, failure: { kind: "gone", message: "Este cadastro não existe ou já foi excluído." } });
  });

  it("Dado um formato inesperado, então devolve null (a confirmação abre e o servidor confere)", () => {
    for (const value of [null, "ok", [], {}, { can_delete: "false" }, { can_delete: false }, { can_delete: false, code: "x" }]) {
      expect(parseDeletionCheck(value)).toBeNull();
    }
  });
});
