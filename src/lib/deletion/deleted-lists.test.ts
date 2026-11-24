import { afterEach, describe, it, expect } from "vitest";
import { DELETED_LIST_TEXTS } from "./texts";
import {
  cellDayTime,
  cellPeople,
  cellScheduleLine,
  deletionInfo,
  personName,
  reportTitleLine,
  withDeletedMark,
  type DeletedCellRow,
} from "./deleted-lists";

// O que os cards e as linhas das listas de excluídos mostram (E2.01, T4, UX-15, UX-16).

describe("deletionInfo", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("'Excluído em dd/MM/aaaa às HH:mm' no horário de Brasília, e 'por {Nome}' (UX-15)", () => {
    expect(
      deletionInfo({ deleted_at: "2026-11-10T17:32:00+00:00", deleted_by_name: "Elisa Martins" }, DELETED_LIST_TEXTS.members.deletedAt),
    ).toEqual({
      deletedAt: "Excluído em 10/11/2026 às 14:32",
      deletedAtShort: "10/11/2026 14:32",
      deletedBy: "por Elisa Martins",
      deletedByShort: "Elisa Martins",
    });
  });

  it("na célula, 'Excluída em'", () => {
    expect(
      deletionInfo({ deleted_at: "2026-11-12T13:05:00Z", deleted_by_name: "Elisa" }, DELETED_LIST_TEXTS.cells.deletedAt).deletedAt,
    ).toBe("Excluída em 12/11/2026 às 10:05");
  });

  it("com o navegador em outro fuso, continua no horário de Brasília (UX-15)", () => {
    process.env.TZ = "Europe/Lisbon";
    expect(
      deletionInfo({ deleted_at: "2026-11-11T02:30:00Z", deleted_by_name: "Elisa" }, DELETED_LIST_TEXTS.members.deletedAt).deletedAt,
    ).toBe("Excluído em 10/11/2026 às 23:30");
  });

  it("sem autor (exclusão vinda do legado): 'Autor não registrado' e, na coluna, 'Não registrado'", () => {
    const info = deletionInfo({ deleted_at: "2026-11-02T12:10:00Z", deleted_by_name: null }, DELETED_LIST_TEXTS.members.deletedAt);
    expect(info.deletedBy).toBe("Autor não registrado");
    expect(info.deletedByShort).toBe("Não registrado");
    expect(deletionInfo({ deleted_at: "2026-11-02T12:10:00Z", deleted_by_name: "  " }, DELETED_LIST_TEXTS.members.deletedAt).deletedBy).toBe(
      "Autor não registrado",
    );
  });
});

describe("marcas e linhas dos cards", () => {
  it("'(cadastro excluído)' ao lado do nome da pessoa excluída", () => {
    expect(withDeletedMark("Gil Souza", true)).toBe("Gil Souza (cadastro excluído)");
    expect(withDeletedMark("Gil Souza", false)).toBe("Gil Souza");
    expect(personName(null)).toBe("Membro sem nome");
    expect(personName(" Ana ")).toBe("Ana");
  });

  const cell: DeletedCellRow = {
    id: "c1",
    type: "Evangelística",
    meeting_day: "Quarta",
    meeting_time: "20:00:00",
    neighborhood: "Centro",
    leader_name: "Carlos Lima",
    leader_deleted: false,
    timothy_name: "Tito Lima",
    timothy_deleted: false,
    host_name: "Quintino Reis",
    host_deleted: true,
    deleted_at: "2026-11-12T13:05:00Z",
    deleted_by_name: null,
  };

  it("as pessoas da célula, na ordem líder, timóteo, anfitrião", () => {
    expect(cellPeople(cell)).toEqual([
      { role: "leader", name: "Carlos Lima", deleted: false },
      { role: "timothy", name: "Tito Lima", deleted: false },
      { role: "host", name: "Quintino Reis", deleted: true },
    ]);
  });

  it("'Quarta · 20:00 · Evangelística', sem o que estiver vazio", () => {
    expect(cellScheduleLine(cell)).toBe("Quarta · 20:00 · Evangelística");
    expect(cellScheduleLine({ ...cell, meeting_time: null })).toBe("Quarta · Evangelística");
    expect(cellDayTime(cell)).toBe("Quarta · 20:00");
    expect(cellDayTime({ meeting_day: null, meeting_time: null })).toBe("");
  });

  it("'Relatório de 19/11/2026 · 20:00', sem a hora se ela não veio", () => {
    expect(reportTitleLine({ date: "2026-11-19", time: "20:00:00" })).toBe("Relatório de 19/11/2026 · 20:00");
    expect(reportTitleLine({ date: "2026-11-19", time: null })).toBe("Relatório de 19/11/2026");
  });
});
