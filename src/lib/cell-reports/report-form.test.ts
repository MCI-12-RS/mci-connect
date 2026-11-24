import { describe, it, expect } from "vitest";
import { APP_ERROR_HINT } from "@/lib/errors";
import { classifyReportSaveError, parseVisitors, toReportWrite } from "./report-form";

// Gravação do formulário de relatório (E2.01, T7, T8, DT-19 e "Estados").

const appError = (code: string, message: string, extra: object = {}) => ({
  code: "22023",
  message,
  details: JSON.stringify({ code, ...extra }),
  hint: APP_ERROR_HINT,
});

describe("parseVisitors", () => {
  it("separa por vírgula e ignora os vazios", () => {
    expect(parseVisitors("João Silva, , Maria Souza ,")).toEqual(["João Silva", "Maria Souza"]);
    expect(parseVisitors("")).toEqual([]);
    expect(parseVisitors(undefined)).toEqual([]);
  });
});

describe("toReportWrite", () => {
  const values = {
    cell_id: "c1",
    date: "2026-11-19",
    time: "20:00",
    was_held: true,
    reason_not_held: "chuva",
    theme: "Fé",
    observations: "ok",
    visitors: "João, Maria",
    offering: 50,
  };

  it("com reunião, grava tema, observações, visitantes e oferta, sem motivo", () => {
    expect(toReportWrite(values)).toEqual({
      cell_id: "c1",
      date: "2026-11-19",
      time: "20:00",
      was_held: true,
      reason_not_held: null,
      theme: "Fé",
      observations: "ok",
      visitors: ["João", "Maria"],
      offering: 50,
    });
  });

  it("'Não houve célula' grava só o motivo", () => {
    expect(toReportWrite({ ...values, was_held: false })).toEqual({
      cell_id: "c1",
      date: "2026-11-19",
      time: "20:00",
      was_held: false,
      reason_not_held: "chuva",
      theme: null,
      observations: null,
      visitors: [],
      offering: 0,
    });
  });
});

describe("classifyReportSaveError", () => {
  it("Dado 'não existe ou já foi excluído', então o relatório sumiu (DT-19)", () => {
    expect(
      classifyReportSaveError(
        appError("not_found_or_deleted", "Este relatório não existe ou já foi excluído.", { entity: "cell_report" }),
      ),
    ).toEqual({ kind: "gone" });
  });

  it("Dada a edição de relatório de célula excluída, então o aviso no topo, com a mensagem do Negócio (UX-28)", () => {
    const message = "A célula deste relatório foi excluída. Restaure a célula para editar o relatório.";
    expect(classifyReportSaveError(appError("report_cell_deleted", message, { cell_id: "c1" }))).toEqual({
      kind: "blocked",
      message,
      cellDeleted: true,
    });
  });

  it("Dado relatório novo para célula excluída, então o aviso no topo (UX-30)", () => {
    const message = "Esta célula foi excluída e não recebe relatórios.";
    expect(classifyReportSaveError(appError("cell_deleted", message, { cell_id: "c1" }))).toEqual({
      kind: "blocked",
      message,
      cellDeleted: true,
    });
  });

  it("Dado um participante excluído entre a escolha e o envio, então a mensagem vai para o campo, com o membro (UX-30)", () => {
    expect(
      classifyReportSaveError(
        appError("deleted_member_chosen", "Este membro foi excluído e não pode ser escolhido.", {
          field: "member_id",
          member_id: "m7",
        }),
      ),
    ).toEqual({ kind: "participants", message: "Este membro foi excluído e não pode ser escolhido.", memberId: "m7" });
  });

  it("Dado o limite de participantes, então a mensagem vai para o campo, sem membro", () => {
    expect(
      classifyReportSaveError(appError("too_many_participants", "Um relatório pode ter no máximo 1000 participantes.")),
    ).toEqual({ kind: "participants", message: "Um relatório pode ter no máximo 1000 participantes.", memberId: null });
  });

  it("Dada a retirada de um participante excluído, então o aviso no topo", () => {
    const message = "Não é possível retirar um participante cujo cadastro foi excluído.";
    expect(classifyReportSaveError(appError("deleted_participant_removal", message, { member_id: "m2" }))).toEqual({
      kind: "blocked",
      message,
      cellDeleted: false,
    });
  });

  it("Dado 42501, então o texto de permissão, sem mensagem técnica (UX-39)", () => {
    expect(classifyReportSaveError({ code: "42501", message: "new row violates row-level security policy" })).toEqual({
      kind: "error",
      message: "Você não tem permissão para esta ação.",
    });
  });

  it("Dada a queda de conexão, então o texto de conexão", () => {
    expect(classifyReportSaveError({ code: "", message: "TypeError: Failed to fetch" })).toEqual({
      kind: "error",
      message: "Não foi possível salvar. Verifique a conexão e tente de novo.",
    });
  });

  it("Dadas as regras de semana dos triggers e do índice único, então os textos de sempre", () => {
    expect(
      classifyReportSaveError({ code: "23505", message: "Já existe um relatório para esta célula nesta semana (2026-11-22 a 2026-11-28)." }),
    ).toEqual({ kind: "error", message: "Já existe um relatório dessa célula nesta semana (domingo a sábado)." });
    expect(
      classifyReportSaveError({ code: "23505", message: 'duplicate key value violates unique constraint "cell_reports_cell_week_key"' }),
    ).toEqual({ kind: "error", message: "Já existe um relatório dessa célula nesta semana (domingo a sábado)." });
    expect(
      classifyReportSaveError({ code: "23514", message: "A data do relatório deve estar dentro da semana atual (2026-11-22 a 2026-11-28)." }),
    ).toEqual({ kind: "error", message: "A data do relatório precisa estar dentro da semana atual (de domingo a sábado)." });
  });

  it("Dado um erro de trigger com texto próprio, então o texto como veio", () => {
    expect(classifyReportSaveError({ code: "P0001", message: "O horário não pode ser anterior ao da célula." })).toEqual({
      kind: "error",
      message: "O horário não pode ser anterior ao da célula.",
    });
  });

  it("Dado um erro técnico, então o texto genérico, sem a mensagem técnica (UX-39)", () => {
    expect(classifyReportSaveError({ code: "22P02", message: "invalid input syntax for type numeric" })).toEqual({
      kind: "error",
      message: "Não foi possível salvar o relatório. Tente de novo.",
    });
    expect(classifyReportSaveError(new Error("boom"))).toEqual({
      kind: "error",
      message: "Não foi possível salvar o relatório. Tente de novo.",
    });
  });
});
