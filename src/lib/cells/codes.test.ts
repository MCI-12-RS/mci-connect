import { describe, expect, it } from "vitest";
import { classifyCellSaveError } from "./codes";

const appError = (code: string, message: string, detail: Record<string, unknown> = {}) => ({
  code: "22023",
  message,
  hint: "app_error",
  details: JSON.stringify({ code, ...detail }),
});

describe("classifyCellSaveError (E2.08, Formato dos erros, T5, UX-11, UX-12)", () => {
  it("as recusas com campo vão para o campo, com o texto do Negócio", () => {
    expect(classifyCellSaveError(appError("timothy_required", "Escolha o timóteo da célula.", { field: "timothy_id" }))).toEqual({
      kind: "field",
      field: "timothy_id",
      message: "Escolha o timóteo da célula.",
    });
    expect(classifyCellSaveError(appError("deleted_member_chosen", "Este membro foi excluído e não pode ser escolhido.", { field: "timothy_id", member_id: "x" })))
      .toEqual({ kind: "field", field: "timothy_id", message: "Este membro foi excluído e não pode ser escolhido." });
  });

  it("PR 2 (pendência): tipo, dia e horário inválidos no campo e célula nova inativa no topo, em pt-BR", () => {
    expect(classifyCellSaveError(appError("cell_type_invalid", "x", { field: "type" }))).toMatchObject({
      kind: "field",
      field: "type",
      message: "Tipo de célula inválido. Escolha Evangelística, Discipulado ou Macrocélula.",
    });
    expect(classifyCellSaveError(appError("meeting_day_invalid", "x", { field: "meeting_day" }))).toMatchObject({
      field: "meeting_day",
      message: "Dia da semana inválido. Escolha de domingo a sábado.",
    });
    expect(classifyCellSaveError(appError("meeting_time_invalid", "x", { field: "meeting_time" }))).toMatchObject({
      field: "meeting_time",
      message: "Horário inválido. Informe a hora e os minutos, entre 00:00 e 23:59.",
    });
    expect(classifyCellSaveError(appError("cell_new_inactive", "x", { field: "is_active" }))).toEqual({
      kind: "top",
      message: "Uma célula nova sempre começa ativa.",
      rereadAccess: false,
    });
  });

  it("escopo e pessoa que não se vê sem campo vão para o topo; célula excluída é gone; 42501 relê o acesso", () => {
    expect(classifyCellSaveError(appError("would_leave_scope", "Com esta alteração, você deixaria de ver esta célula.", { entity: "cell" }))).toMatchObject({ kind: "top" });
    expect(classifyCellSaveError(appError("person_not_visible", "Você só pode escolher pessoas que você vê."))).toMatchObject({ kind: "top" });
    expect(classifyCellSaveError(appError("not_found_or_deleted", "x", { entity: "cell" }))).toEqual({ kind: "gone" });
    expect(classifyCellSaveError({ code: "42501", message: "permission denied for table cells" })).toEqual({
      kind: "top",
      message: "Você não tem permissão para esta ação.",
      rereadAccess: true,
    });
  });

  it("reservas sem texto técnico: 22007/22008, 23514, 23502 e 23505 em cells_pkey", () => {
    expect(classifyCellSaveError({ code: "22008", message: 'date/time field value out of range: "25:00"' })).toMatchObject({ field: "meeting_time" });
    expect(classifyCellSaveError({ code: "22007", message: 'invalid input syntax for type time: "73:0"' })).toMatchObject({ field: "meeting_time" });
    expect(
      classifyCellSaveError({ code: "23514", message: 'new row for relation "cells" violates check constraint "cells_meeting_day_check"' }),
    ).toEqual({ kind: "field", field: "meeting_day", message: "Dia da semana inválido. Escolha de domingo a sábado." });
    expect(
      classifyCellSaveError({ code: "23502", message: 'null value in column "host_id" of relation "cells" violates not-null constraint' }),
    ).toEqual({ kind: "field", field: "host_id", message: "Escolha o anfitrião da célula." });
    expect(classifyCellSaveError({ code: "23505", message: 'duplicate key value violates unique constraint "cells_pkey"' })).toEqual({ kind: "duplicate" });
  });

  it("rede, 5xx e desconhecidos: conexão; recálculo do E2.06: recalc", () => {
    expect(classifyCellSaveError({ code: "", message: "TypeError: Failed to fetch" })).toEqual({ kind: "connection" });
    expect(classifyCellSaveError(new Error("boom"))).toEqual({ kind: "connection" });
    expect(classifyCellSaveError({ code: "40P01", message: "deadlock detected" })).toEqual({ kind: "recalc" });
  });
});
