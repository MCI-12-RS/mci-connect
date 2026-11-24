import { describe, it, expect } from "vitest";
import { leaderLabel, toCellDeletionTarget, toCellReportDeletionTarget } from "./targets";

// O que a confirmação mostra da célula e do relatório (E2.01, T1 e T2).

const cell = {
  id: "c1",
  leader_name: "Carlos Lima",
  meeting_day: "Quarta",
  meeting_time: "20:00:00",
  street: "Rua das Flores",
  number: "120",
  neighborhood: "Centro",
  is_active: true,
};

describe("toCellDeletionTarget", () => {
  it("título pelo líder e a linha '{Dia}, {hora} · {endereço}' (T2)", () => {
    expect(toCellDeletionTarget(cell)).toEqual({
      id: "c1",
      leaderName: "Carlos Lima",
      summary: "Quarta, 20:00 · Rua das Flores, 120",
      isActive: true,
    });
  });

  it("omite da linha o que a célula não tem", () => {
    expect(toCellDeletionTarget({ ...cell, street: null, neighborhood: null }).summary).toBe("Quarta, 20:00");
    expect(toCellDeletionTarget({ ...cell, meeting_time: null }).summary).toBe("Quarta · Rua das Flores, 120");
    expect(toCellDeletionTarget({ ...cell, meeting_day: null, meeting_time: null }).summary).toBe("Rua das Flores, 120");
    expect(
      toCellDeletionTarget({ ...cell, meeting_day: null, meeting_time: null, street: null, neighborhood: null }).summary,
    ).toBe("");
  });

  it("célula inativa não tem o aviso de inativar (UX-05)", () => {
    expect(toCellDeletionTarget({ ...cell, is_active: false }).isActive).toBe(false);
    expect(toCellDeletionTarget({ ...cell, is_active: null }).isActive).toBe(false);
  });

  it("líder sem nome", () => {
    expect(toCellDeletionTarget({ ...cell, leader_name: null }).leaderName).toBe("Membro sem nome");
  });
});

describe("toCellReportDeletionTarget", () => {
  it("a data em dd/MM/aaaa e o líder da célula", () => {
    expect(toCellReportDeletionTarget({ id: "r1", date: "2026-11-19", cell_leader_name: "Carlos Lima" })).toEqual({
      id: "r1",
      date: "19/11/2026",
      leaderName: "Carlos Lima",
    });
  });
});

describe("leaderLabel", () => {
  it("o nome, ou 'Membro sem nome'", () => {
    expect(leaderLabel("Ana")).toBe("Ana");
    expect(leaderLabel("")).toBe("Membro sem nome");
    expect(leaderLabel(null)).toBe("Membro sem nome");
  });
});
