import { ACCESS_ERROR_CODES, isAccessErrorCode, refusalField, refusalMessage } from "./codes";
import { parseAppError } from "@/lib/errors";
import { DELETION_ERROR_CODES } from "@/lib/deletion/codes";

const appError = (detail: Record<string, unknown>, message = "Você só pode escolher pessoas que você vê.") => ({
  code: "22023",
  message,
  details: JSON.stringify(detail),
  hint: "app_error",
});

describe("códigos do E2.02 (AQ-5)", () => {
  it("reconhece os códigos e não repete os do E2.01", () => {
    expect(isAccessErrorCode("person_not_visible")).toBe(true);
    expect(isAccessErrorCode("not_found_or_deleted")).toBe(false);
    const deletion: readonly string[] = DELETION_ERROR_CODES;
    for (const code of ACCESS_ERROR_CODES) expect(deletion).not.toContain(code);
  });
});

describe("refusalMessage (UX-30)", () => {
  it("42501 vira o texto genérico, sem nada técnico", () => {
    const message = refusalMessage({ code: "42501", message: "new row violates row-level security policy" });
    expect(message).toBe("Você não tem permissão para esta ação.");
  });

  it("a regra mostra a mensagem do banco", () => {
    expect(refusalMessage(appError({ code: "person_not_visible", field: "leader_id" }))).toBe(
      "Você só pode escolher pessoas que você vê.",
    );
  });

  it("outros erros: null", () => {
    expect(refusalMessage({ code: "", message: "TypeError: Failed to fetch" })).toBeNull();
    expect(refusalMessage(null)).toBeNull();
  });
});

describe("refusalField (T11)", () => {
  it("devolve o campo que o servidor apontou", () => {
    const parsed = parseAppError(appError({ code: "person_not_visible", field: "spouse_id", member_id: "x" }));
    expect(parsed && refusalField(parsed)).toBe("spouse_id");
  });

  it("sem campo, ou com um campo desconhecido: null", () => {
    const noField = parseAppError(appError({ code: "would_leave_scope", entity: "member" }));
    const unknown = parseAppError(appError({ code: "person_not_visible", field: "drop table" }));
    expect(noField && refusalField(noField)).toBeNull();
    expect(unknown && refusalField(unknown)).toBeNull();
  });
});
