import { afterEach, describe, it, expect, vi } from "vitest";
import { DELETED_LIST_TEXTS } from "./texts";
import {
  cellDayTime,
  cellPeople,
  cellScheduleLine,
  deletedCellHelpers,
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
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
    vi.resetModules();
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

  it("com o navegador em outro fuso, continua no horário de Brasília (UX-15)", async () => {
    // O formatador de data é criado na carga do módulo: o fuso muda antes de carregá-lo de novo.
    process.env.TZ = "Europe/Lisbon";
    vi.resetModules();
    const { deletionInfo: inLisbon } = await import("./deleted-lists");
    // Sanidade: em Lisboa, o mesmo instante já é outro dia (11/11 02:30).
    expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("Europe/Lisbon");
    expect(new Date("2026-11-11T02:30:00Z").getDate()).toBe(11);
    expect(
      inLisbon({ deleted_at: "2026-11-11T02:30:00Z", deleted_by_name: "Elisa" }, DELETED_LIST_TEXTS.members.deletedAt),
    ).toMatchObject({ deletedAt: "Excluído em 10/11/2026 às 23:30", deletedAtShort: "10/11/2026 23:30" });
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
    leader_id: "m-carlos",
    leader_name: "Carlos Lima",
    leader_deleted: false,
    timothy_id: "m-tito",
    timothy_name: "Tito Lima",
    timothy_deleted: false,
    host_id: "m-quintino",
    host_name: "Quintino Reis",
    host_deleted: true,
    deleted_at: "2026-11-12T13:05:00Z",
    deleted_by_name: null,
    deleted_by_kind: null,
  };

  it("as pessoas da célula, na ordem líder, timóteo, anfitrião", () => {
    expect(cellPeople(cell)).toEqual([
      { role: "leader", id: "m-carlos", name: "Carlos Lima", deleted: false },
      { role: "timothy", id: "m-tito", name: "Tito Lima", deleted: false },
      { role: "host", id: "m-quintino", name: "Quintino Reis", deleted: true },
    ]);
  });

  it("no card, só o timóteo e o anfitrião excluídos, sem repetir o líder", () => {
    expect(deletedCellHelpers(cell).map((person) => person.role)).toEqual(["host"]);
    expect(deletedCellHelpers({ ...cell, host_deleted: false })).toEqual([]);
    // O líder excluído que também é o anfitrião já aparece no título, com a marca.
    const leaderIsHost = { ...cell, leader_deleted: true, host_id: "m-carlos", host_name: "Carlos Lima" };
    expect(deletedCellHelpers(leaderIsHost)).toEqual([]);
    const leaderIsTimothy = { ...leaderIsHost, timothy_id: "m-carlos", timothy_name: "Carlos Lima", timothy_deleted: true };
    expect(deletedCellHelpers(leaderIsTimothy)).toEqual([]);
    // Outra pessoa excluída continua, mesmo com o líder repetido em outro papel.
    expect(deletedCellHelpers({ ...leaderIsHost, timothy_deleted: true }).map((person) => person.name)).toEqual(["Tito Lima"]);
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

describe("E2.05, UX-10 e RN-11: autor das exclusões do sistema anterior (T6)", () => {
  const at = "2025-02-02T13:00:00Z";
  const info = (deleted_by_kind: "member" | "legacy" | "unknown" | "system" | null, deleted_by_name: string | null) =>
    deletionInfo({ deleted_at: at, deleted_by_kind, deleted_by_name }, DELETED_LIST_TEXTS.cellReports.deletedAt);

  it("legado com nome: 'por João Pires (sistema anterior)' no card e 'João Pires (sistema anterior)' na coluna", () => {
    expect(info("legacy", "João Pires")).toMatchObject({
      deletedBy: "por João Pires (sistema anterior)",
      deletedByShort: "João Pires (sistema anterior)",
    });
  });

  it("'AdminUser' aparece como 'Administrador (sistema anterior)'", () => {
    expect(info("legacy", "AdminUser").deletedByShort).toBe("Administrador (sistema anterior)");
    expect(info("legacy", "Administrador").deletedByShort).toBe("Administrador (sistema anterior)");
  });

  it("sem nome: 'Autor não registrado' e 'Não registrado'", () => {
    expect(info("legacy", null)).toMatchObject({ deletedBy: "Autor não registrado", deletedByShort: "Não registrado" });
    expect(info("unknown", null)).toMatchObject({ deletedBy: "Autor não registrado", deletedByShort: "Não registrado" });
  });

  it("as exclusões feitas no novo continuam 'por {Nome}'; sem tipo (DT-23), vale o nome", () => {
    expect(info("member", "Ana Souza").deletedBy).toBe("por Ana Souza");
    expect(info(null, "Ana Souza").deletedBy).toBe("por Ana Souza");
  });
});
