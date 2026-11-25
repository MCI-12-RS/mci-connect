import { describe, expect, it } from "vitest";
import { cellRefusalFromError } from "./cell-form";
import { RULE_TEXTS } from "./texts";

const appError = (detail: Record<string, unknown>, message: string) => ({
  code: "22023",
  message,
  details: JSON.stringify(detail),
  hint: "app_error",
});

describe("cellRefusalFromError (T7, T11, UX-22, UX-24)", () => {
  it("RN-09 (c): a mensagem de 'deixaria de ver esta célula' vai para o topo, sem reler o acesso", () => {
    const error = appError({ code: "would_leave_scope", entity: "cell" }, RULE_TEXTS.wouldLeaveScopeCell);
    expect(cellRefusalFromError(error)).toEqual({ message: RULE_TEXTS.wouldLeaveScopeCell, field: null, rereadAccess: false });
  });

  it("RN-09 (b): embaixo do campo de pessoa que o servidor apontou", () => {
    for (const field of ["leader_id", "timothy_id", "host_id"]) {
      expect(cellRefusalFromError(appError({ code: "person_not_visible", field }, RULE_TEXTS.personNotVisible))).toEqual({
        message: RULE_TEXTS.personNotVisible,
        field,
        rereadAccess: false,
      });
    }
  });

  it("RN-09 (b) sem campo, ou com um campo que não é da célula: no topo", () => {
    expect(cellRefusalFromError(appError({ code: "person_not_visible" }, "x"))?.field).toBeNull();
    expect(cellRefusalFromError(appError({ code: "person_not_visible", field: "spouse_id" }, "x"))?.field).toBeNull();
  });

  it("o campo só vale para a RN-09 (b)", () => {
    expect(cellRefusalFromError(appError({ code: "would_leave_scope", field: "host_id" }, "x"))?.field).toBeNull();
  });

  it("42501: o texto do E2.01 no topo, e a tela relê o acesso (UX-30)", () => {
    expect(cellRefusalFromError({ code: "42501", message: "permission denied for table cells" })).toEqual({
      message: "Você não tem permissão para esta ação.",
      field: null,
      rereadAccess: true,
    });
  });

  it("o que não é recusa (rede, erro técnico) devolve null", () => {
    expect(cellRefusalFromError(new TypeError("Failed to fetch"))).toBeNull();
    expect(cellRefusalFromError({ code: "XX000", message: "boom" })).toBeNull();
  });
});
