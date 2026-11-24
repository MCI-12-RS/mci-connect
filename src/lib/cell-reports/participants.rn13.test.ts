import { describe, it, expect } from "vitest";
import type { ReportParticipant } from "@/lib/cell-reports/fields";
import { finalParticipantIds, splitSavedParticipants } from "./participants";

// RN-13 (E2.01): ao editar um relatório, o participante de cadastro excluído
// nunca sai do conjunto enviado a set_cell_report_participants, qualquer que
// seja a escolha no seletor. Complementa participants.test.ts com invariantes.

const participant = (id: string, name: string, deleted: boolean): ReportParticipant => ({
  member_id: id,
  member_name: name,
  member_deleted: deleted,
});

/** R: Ana e Bruno (não excluídos), Sara e Quintino (excluídos). */
const saved = [
  participant("m-ana", "Ana Souza", false),
  participant("m-bruno", "Bruno Lima", false),
  participant("m-sara", "Sara Reis", true),
  participant("m-quintino", "Quintino Reis", true),
];

/** Todos os subconjuntos de uma lista. */
const subsets = <T,>(items: readonly T[]): T[][] =>
  items.reduce<T[][]>((all, item) => [...all, ...all.map((subset) => [...subset, item])], [[]]);

describe("RN-13: o participante excluído nunca é retirado na edição", () => {
  it("Dada uma edição sem mudança no seletor, então o conjunto final é exatamente o salvo (nada é retirado)", () => {
    const { editable, kept } = splitSavedParticipants(saved);
    const final = finalParticipantIds(
      editable.map((option) => option.value),
      kept,
    );
    expect([...final].sort()).toEqual(saved.map((p) => p.member_id).sort());
  });

  it("Para qualquer combinação de escolhas (inclusive retirar todos e acrescentar outros), Sara e Quintino continuam no conjunto final, sem repetição", () => {
    const { kept } = splitSavedParticipants(saved);
    const candidates = ["m-ana", "m-bruno", "m-caio", "m-dani"];
    for (const chosen of subsets(candidates)) {
      const final = finalParticipantIds(chosen, kept);
      expect(final, chosen.join(",")).toEqual(expect.arrayContaining(["m-sara", "m-quintino", ...chosen]));
      expect(new Set(final).size, chosen.join(",")).toBe(final.length);
      expect(final.filter((id) => !chosen.includes(id)).sort(), chosen.join(",")).toEqual(["m-quintino", "m-sara"]);
    }
  });

  it("RN-06: o seletor não recebe os excluídos como opção escolhida (eles não podem ser escolhidos de novo)", () => {
    const { editable } = splitSavedParticipants(saved);
    expect(editable.map((option) => option.value)).toEqual(["m-ana", "m-bruno"]);
  });

  it("Lista com mais de 1000 participantes: a tela não corta nada; o limite é do servidor (too_many_participants)", () => {
    const many = Array.from({ length: 1500 }, (_, i) => participant(`m-${i}`, `Membro ${i}`, i % 10 === 0));
    const { editable, kept } = splitSavedParticipants(many);
    expect(editable).toHaveLength(1350);
    expect(kept).toHaveLength(150);
    expect(finalParticipantIds(editable.map((option) => option.value), kept)).toHaveLength(1500);
  });
});
