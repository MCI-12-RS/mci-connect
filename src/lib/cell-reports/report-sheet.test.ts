import { afterEach, describe, it, expect, vi } from "vitest";
import type { CellReportDetail, CellReportDetailRow } from "./fields";
import { reportDateTime, reportSheetState, toReportSheetView, type ReportSheetInput } from "./report-sheet";

// Consulta do relatório de célula excluída (E2.01, T7, UXD-7; RN-09 b, RN-11 e
// RN-13; UX-26 e UX-27).

const report = (overrides: Partial<CellReportDetailRow> = {}): CellReportDetailRow => ({
  id: "r1",
  date: "2026-11-19",
  time: "20:00:00",
  theme: "Fé que move montanhas",
  observations: null,
  visitors: ["João", "Maria"],
  offering: 50,
  was_held: true,
  reason_not_held: null,
  cell_leader_name: "Carlos Lima",
  cell_deleted: true,
  ...overrides,
});

const detail = (overrides: Partial<CellReportDetailRow> = {}, participants: CellReportDetail["participants"] = []): CellReportDetail => ({
  report: report(overrides),
  participants,
});

// O Intl separa o "R$" do valor com um espaço inseparável.
const brl = (text: string) => text.replace(" ", " ");

describe("reportSheetState: o ?report=<id> da URL (Navegação e rotas, PO-UX-3)", () => {
  const input = (overrides: Partial<ReportSheetInput>): ReportSheetInput => ({
    reportId: "r1",
    permissionsLoaded: true,
    canView: true,
    detail: undefined,
    knownCellDeleted: false,
    failed: false,
    alreadyOpen: false,
    ...overrides,
  });

  it("sem o parâmetro, o painel fica fechado", () => {
    expect(reportSheetState(input({ reportId: null }))).toBe("closed");
  });

  it("enquanto as permissões não chegam, nada é decidido: o parâmetro fica e o painel não abre", () => {
    expect(reportSheetState(input({ permissionsLoaded: false, canView: false }))).toBe("closed");
  });

  it("sem edit_cell_report, o parâmetro é ignorado e sai da URL", () => {
    expect(reportSheetState(input({ canView: false }))).toBe("dismiss");
    expect(reportSheetState(input({ canView: false, detail: detail() }))).toBe("dismiss");
    expect(reportSheetState(input({ canView: false, knownCellDeleted: true }))).toBe("dismiss");
  });

  it("com a permissão, abre quando o relatório é de célula excluída", () => {
    expect(reportSheetState(input({ detail: detail({ cell_deleted: true }) }))).toBe("open");
  });

  it("tocado na lista (a linha já diz 'Célula excluída'): abre enquanto carrega, com o Skeleton", () => {
    expect(reportSheetState(input({ knownCellDeleted: true }))).toBe("open");
  });

  it("link direto ou recarregar: espera a leitura fechado, sem piscar; se ela falhar, abre com 'Tentar de novo'", () => {
    expect(reportSheetState(input({}))).toBe("closed");
    expect(reportSheetState(input({ failed: true }))).toBe("open");
  });

  it("já aberto para o relatório (QA-E201-PR4-1): continua aberto enquanto lê de novo, até o resultado", () => {
    // "Tentar de novo" num link direto: a leitura volta a carregar, sem o erro.
    expect(reportSheetState(input({ alreadyOpen: true }))).toBe("open");
    // O resultado ainda decide: relatório de célula não excluída sai da URL.
    expect(reportSheetState(input({ alreadyOpen: true, detail: detail({ cell_deleted: false }) }))).toBe("dismiss");
    expect(reportSheetState(input({ alreadyOpen: true, canView: false }))).toBe("dismiss");
    expect(reportSheetState(input({ alreadyOpen: true, reportId: null }))).toBe("closed");
  });

  it("relatório de célula não excluída: ignorado e sai da URL (a consulta é só desse relatório neste passo)", () => {
    expect(reportSheetState(input({ detail: detail({ cell_deleted: false }) }))).toBe("dismiss");
    expect(reportSheetState(input({ detail: detail({ cell_deleted: null }) }))).toBe("dismiss");
    // A lista estava desatualizada (a célula foi restaurada): vale a leitura.
    expect(reportSheetState(input({ knownCellDeleted: true, detail: detail({ cell_deleted: false }) }))).toBe("dismiss");
  });

  it("relatório que não veio (excluído no meio tempo ou fora do escopo): abre com 'não existe ou já foi excluído'", () => {
    expect(reportSheetState(input({ detail: null }))).toBe("open");
  });
});

describe("toReportSheetView: célula realizada (T7, UX-27)", () => {
  it("cabeçalho, data e hora, tema, participantes, visitantes, oferta em BRL e observações", () => {
    const view = toReportSheetView(
      detail({ observations: "Muito boa" }, [
        { member_id: "m1", member_name: "Ana Souza", member_deleted: false },
        { member_id: "m2", member_name: "Bruno Lima", member_deleted: false },
      ]),
    );
    expect(view).toEqual({
      status: "held",
      title: "Relatório de 19/11/2026",
      cellLine: "Célula de Carlos Lima",
      cellDeleted: true,
      deletedCellsPath: "/cells/deleted?q=Carlos+Lima",
      dateTime: "Quinta, 19/11/2026 às 20:00",
      theme: "Fé que move montanhas",
      participants: ["Ana Souza", "Bruno Lima"],
      visitorsCount: 2,
      visitors: "João, Maria",
      offering: brl("R$ 50,00"),
      observations: "Muito boa",
    });
  });

  it("o participante excluído aparece só pelo nome, na ordem da consulta, e conta no total (RN-13)", () => {
    const view = toReportSheetView(
      detail({}, [
        { member_id: "m1", member_name: "Ana Souza", member_deleted: false },
        { member_id: "m9", member_name: "Sara Reis", member_deleted: true },
      ]),
    );
    expect(view.status === "held" && view.participants).toEqual(["Ana Souza", "Sara Reis"]);
  });

  it("campos vazios: 'Não informado'; sem participantes, a lista vazia; oferta 0 é R$ 0,00", () => {
    const view = toReportSheetView(detail({ theme: "  ", observations: "", visitors: [], offering: 0 }));
    expect(view).toMatchObject({
      status: "held",
      theme: "Não informado",
      observations: "Não informado",
      participants: [],
      visitorsCount: 0,
      visitors: "Não informado",
      offering: brl("R$ 0,00"),
    });
  });

  it("sem oferta, 'Não informado'; visitantes sem nome não contam", () => {
    const view = toReportSheetView(detail({ offering: null, visitors: ["João", " ", ""] }));
    expect(view).toMatchObject({ offering: "Não informado", visitorsCount: 1, visitors: "João" });
  });

  it("participante sem nome: 'Membro sem nome'", () => {
    const view = toReportSheetView(detail({}, [{ member_id: "m1", member_name: null, member_deleted: true }]));
    expect(view.status === "held" && view.participants).toEqual(["Membro sem nome"]);
  });
});

describe("toReportSheetView: 'Não houve célula' (T7)", () => {
  it("situação 'Não realizada' com o motivo, sem tema, participantes, visitantes e oferta", () => {
    const view = toReportSheetView(
      detail({ was_held: false, theme: null, reason_not_held: "Chuva forte", offering: 0 }, [
        { member_id: "m1", member_name: "Ana Souza", member_deleted: false },
      ]),
    );
    expect(view).toEqual({
      status: "notHeld",
      title: "Relatório de 19/11/2026",
      cellLine: "Célula de Carlos Lima",
      cellDeleted: true,
      deletedCellsPath: "/cells/deleted?q=Carlos+Lima",
      dateTime: "Quinta, 19/11/2026 às 20:00",
      reason: "Chuva forte",
      observations: "Não informado",
    });
  });

  it("sem motivo, 'Não informado'", () => {
    expect(toReportSheetView(detail({ was_held: false, reason_not_held: null }))).toMatchObject({ reason: "Não informado" });
  });
});

describe("toReportSheetView: a célula e o líder", () => {
  it("célula não excluída: sem a indicação (para o E2.12 reaproveitar o painel)", () => {
    expect(toReportSheetView(detail({ cell_deleted: false })).cellDeleted).toBe(false);
  });

  it("célula sem líder: 'Membro sem nome', como nos rótulos da linha, e a lista de excluídas sem busca", () => {
    const view = toReportSheetView(detail({ cell_leader_name: null }));
    expect(view.cellLine).toBe("Célula de Membro sem nome");
    expect(view.deletedCellsPath).toBe("/cells/deleted");
  });

  it("o nome do líder vai codificado na busca", () => {
    expect(toReportSheetView(detail({ cell_leader_name: "Ana & Zé" })).deletedCellsPath).toBe("/cells/deleted?q=Ana+%26+Z%C3%A9");
  });
});

describe("reportDateTime", () => {
  it("dia da semana, data dd/MM/aaaa e hora em 24 h", () => {
    expect(reportDateTime({ date: "2026-11-22", time: "09:05:00" })).toBe("Domingo, 22/11/2026 às 09:05");
    expect(reportDateTime({ date: "2026-11-28", time: "23:30:00" })).toBe("Sábado, 28/11/2026 às 23:30");
  });

  it("sem hora, só o dia e a data; sem data, 'Não informado'", () => {
    expect(reportDateTime({ date: "2026-11-19", time: null })).toBe("Quinta, 19/11/2026");
    expect(reportDateTime({ date: null, time: "20:00:00" })).toBe("Não informado");
  });

  describe("não depende do fuso do navegador", () => {
    const originalTz = process.env.TZ;
    afterEach(() => {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
      vi.resetModules();
    });

    // A data e a hora do relatório são colunas sem fuso, já no horário de
    // Brasília: o dia não pode mudar em Tóquio (UTC+9) nem em Los Angeles (UTC-8).
    it.each(["Asia/Tokyo", "America/Los_Angeles"])("%s", async (tz) => {
      process.env.TZ = tz;
      vi.resetModules();
      const { reportDateTime: format } = await import("./report-sheet");
      expect(format({ date: "2026-11-22", time: "00:30:00" })).toBe("Domingo, 22/11/2026 às 00:30");
      expect(format({ date: "2026-11-28", time: "23:30:00" })).toBe("Sábado, 28/11/2026 às 23:30");
    });
  });
});
