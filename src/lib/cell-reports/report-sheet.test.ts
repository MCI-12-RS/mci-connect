import { describe, it, expect } from "vitest";
import {
  closeMode,
  onReportEditEntry,
  readReportParam,
  reportSheetActions,
  reportSheetDateTime,
  sortParticipantNames,
  toReportSheetView,
  type HasPermission,
} from "./report-sheet";
import { reportDetailRow, reportListRow } from "@/test/report-snapshot-fixture";

// A consulta "Ver relatório" (E2.12, T10 a T13; RN-16, RN-17; AQ-8; DA-8, DA-9).

const ID = "11111111-1111-4111-8111-111111111111";

describe("readReportParam e closeMode (AQ-8)", () => {
  it("só o id com formato abre a consulta", () => {
    expect(readReportParam(new URLSearchParams(`report=${ID}`))).toBe(ID);
    expect(readReportParam(new URLSearchParams("report=xyz"))).toBeNull();
    expect(readReportParam(new URLSearchParams(""))).toBeNull();
  });

  it("aberta pela linha, fechar volta a entrada; por link, tira o parâmetro com replace", () => {
    expect(closeMode({ reportFromList: true })).toBe("back");
    expect(closeMode(null)).toBe("replace");
    expect(closeMode({ fromList: true })).toBe("replace");
  });

  it("a entrada da edição por cima da consulta é a que traz reportEdit (DA-11)", () => {
    expect(onReportEditEntry({ reportFromList: true, reportEdit: true })).toBe(true);
    expect(onReportEditEntry({ reportFromList: true })).toBe(false);
    expect(onReportEditEntry({ reportEdit: "true" })).toBe(false);
    expect(onReportEditEntry(null)).toBe(false);
  });
});

describe("toReportSheetView (T10, T11, T12)", () => {
  it("R1 lido por id: o título, a célula atual, a reunião, os visitantes, a oferta, as pessoas registradas e o endereço", () => {
    const view = toReportSheetView(reportDetailRow(), null);
    expect(view).toMatchObject({
      title: "Relatório de 18/11/2026",
      cellLine: "Célula de André Souza · Quarta · 20:00",
      held: true,
      cellDeleted: false,
      meeting: {
        dateLabel: "Data e horário",
        dateTime: "Quarta, 18/11/2026 às 20:00",
        theme: "A fé que vence",
        reason: null,
        offering: "R$ 50,00",
        observations: "Dois visitantes do trabalho do Caio",
        participantsCount: 8,
        visitors: ["João Pereira", "Maria Lima"],
      },
      address: ["Rua das Flores, 100", "Centro · Porto Alegre, RS", "CEP 90010-000"],
    });
    expect(view?.people).toEqual([
      { label: "Líder", value: "André Souza" },
      { label: "Timóteo", value: "Caio Lima" },
      { label: "Anfitrião", value: "Carla Dias" },
      { label: "G12", value: "Pedro Alves", none: false },
      { label: "Tipo", value: "Evangelística" },
    ]);
  });

  it("R5, com o retrato: o topo é a célula atual, e as pessoas são as registradas (P-LRE-22)", () => {
    const view = toReportSheetView(reportDetailRow({ snapshot_leader_name: "Fábio Lima", snapshot_cell_type: "Discipulado" }), null);
    expect(view?.cellLine).toBe("Célula de André Souza · Quarta · 20:00");
    expect(view?.people?.[0]).toEqual({ label: "Líder", value: "Fábio Lima" });
    expect(view?.people?.[4]).toEqual({ label: "Tipo", value: "Discipulado" });
  });

  it("Não houve célula: Reunião prevista e o motivo, sem tema, oferta, visitantes e participantes, mesmo vindos do legado", () => {
    const view = toReportSheetView(
      reportDetailRow({ was_held: false, reason_not_held: "Chuva forte no bairro", date: "2026-11-11", theme: "Legado", offering: 10 }),
      null,
    );
    expect(view?.meeting).toMatchObject({
      dateLabel: "Reunião prevista",
      reason: "Chuva forte no bairro",
      theme: null,
      offering: null,
      visitors: [],
      participantsCount: 0,
    });
  });

  it("só com a linha da lista (prévia): o topo e o relatório na hora, as pessoas e o endereço completo ainda não", () => {
    const view = toReportSheetView(undefined, reportListRow());
    expect(view?.title).toBe("Relatório de 18/11/2026");
    expect(view?.meeting.theme).toBe("A fé que vence");
    expect(view?.people).toBeNull();
    expect(view?.address).toBeNull();
  });

  it("sem leitura nem prévia, nada (o corpo em Skeleton); sem observações, nada; sem endereço, lista vazia", () => {
    expect(toReportSheetView(undefined, null)).toBeNull();
    expect(toReportSheetView(reportDetailRow({ observations: "  " }), null)?.meeting.observations).toBeNull();
    expect(
      toReportSheetView(
        reportDetailRow({ cell_street: null, cell_number: null, cell_neighborhood: null, cell_city: null, cell_state: null, cell_zip_code: null }),
        null,
      )?.address,
    ).toEqual([]);
  });

  it("G12 nenhum: o — com a marca para o leitor de tela", () => {
    const view = toReportSheetView(reportDetailRow({ snapshot_leader_g12_level: null, snapshot_g12_leader_name: null }), null);
    expect(view?.people?.[3]).toEqual({ label: "G12", value: "—", none: true });
  });

  it("a data por extenso, sem hora quando não há", () => {
    expect(reportSheetDateTime("2026-11-22", "18:00:00")).toBe("Domingo, 22/11/2026 às 18:00");
    expect(reportSheetDateTime("2026-11-22", null)).toBe("Domingo, 22/11/2026");
  });
});

describe("sortParticipantNames (DA-8)", () => {
  it("sem diferenciar acentos e maiúsculas, com o id no empate; o excluído aparece igual", () => {
    expect(
      sortParticipantNames([
        { member_id: "2", member_name: "Débora Lins" },
        { member_id: "1", member_name: "André Souza" },
        { member_id: "4", member_name: "ana Paula" },
        { member_id: "3", member_name: "Ana Paula" },
        { member_id: "5", member_name: null },
      ]),
    ).toEqual(["Ana Paula", "ana Paula", "André Souza", "Débora Lins", "Membro sem nome"]);
  });
});

describe("reportSheetActions (RN-16 c, UXD-9)", () => {
  const has =
    (...perms: string[]): HasPermission =>
    (permission) =>
      perms.includes(permission);

  it("Caio, sem editar nem excluir: só os links", () => {
    expect(reportSheetActions(has(), reportDetailRow())).toEqual({
      edit: false,
      delete: false,
      viewCell: true,
      seeDeletedCells: false,
      cellId: reportDetailRow().cell_id,
    });
  });

  it("Pedro edita e exclui; Lia, sem ver a célula, não tem Ver célula", () => {
    expect(reportSheetActions(has("edit_cell_report", "delete_cell_report"), reportDetailRow())).toMatchObject({ edit: true, delete: true });
    expect(reportSheetActions(has(), reportDetailRow({ cell_visible: false })).viewCell).toBe(false);
  });

  it("célula excluída: sem Editar e sem Ver célula; Excluir continua", () => {
    const actions = reportSheetActions(has("edit_cell_report", "delete_cell_report", "manage_roles"), reportDetailRow({ cell_deleted: true }));
    expect(actions).toMatchObject({ edit: false, delete: true, viewCell: false, seeDeletedCells: true });
  });

  it("no detalhe da célula (T14): sem Ver célula; editar, excluir e Ver todos os relatórios continuam", () => {
    const actions = reportSheetActions(has("edit_cell_report", "delete_cell_report"), reportDetailRow(), "cell");
    expect(actions).toEqual({ edit: true, delete: true, viewCell: false, seeDeletedCells: false, cellId: reportDetailRow().cell_id });
  });
});
