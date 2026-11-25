import { describe, it, expect } from "vitest";
import {
  finalParticipantIds,
  hasHiddenParticipants,
  hiddenParticipantIds,
  keptParticipantsLine,
  markDeletedChoice,
  splitSavedParticipants,
  toParticipantOptions,
} from "./participants";

const saved = (member_id: string, member_name: string | null, member_deleted = false) => ({
  member_id,
  member_name,
  member_deleted,
});

describe("toParticipantOptions (RN-06, RN-07)", () => {
  it("participante já salvo vira opção selecionada com o nome, inclusive inativo ou fora do escopo", () => {
    expect(toParticipantOptions([saved("m1", "Ana"), saved("m9", "Carlos (inativo)")])).toEqual([
      { value: "m1", label: "Ana" },
      { value: "m9", label: "Carlos (inativo)" },
    ]);
  });

  it("mantém a ordem dos participantes salvos", () => {
    expect(toParticipantOptions([saved("m9", "Carlos"), saved("m1", "Ana")]).map((o) => o.value)).toEqual(["m9", "m1"]);
  });

  it("participante salvo sem nome não some da seleção", () => {
    expect(toParticipantOptions([saved("x", null)])).toEqual([{ value: "x", label: "Membro sem nome" }]);
  });

  it("nenhum participante", () => {
    expect(toParticipantOptions([])).toEqual([]);
  });
});

describe("splitSavedParticipants (E2.01, RN-13, UXD-8)", () => {
  it("Dado R com Ana e Sara, e Sara excluída, então Ana fica no seletor e Sara fica de fora, sem ✕", () => {
    expect(splitSavedParticipants([saved("m1", "Ana"), saved("m2", "Sara", true)])).toEqual({
      editable: [{ value: "m1", label: "Ana" }],
      kept: [{ id: "m2", name: "Sara" }],
    });
  });

  it("mantém a ordem (alfabética, como vem da view) nos dois grupos", () => {
    const { editable, kept } = splitSavedParticipants([
      saved("a", "Ana", true),
      saved("b", "Bruno"),
      saved("c", "Carla", true),
      saved("d", "Davi"),
    ]);
    expect(editable.map((o) => o.label)).toEqual(["Bruno", "Davi"]);
    expect(kept.map((p) => p.name)).toEqual(["Ana", "Carla"]);
  });

  it("excluído sem nome aparece como 'Membro sem nome'", () => {
    expect(splitSavedParticipants([saved("x", null, true)]).kept).toEqual([{ id: "x", name: "Membro sem nome" }]);
  });

  it("member_deleted nulo conta como não excluído", () => {
    const { editable, kept } = splitSavedParticipants([{ member_id: "m1", member_name: "Ana", member_deleted: null }]);
    expect(editable).toHaveLength(1);
    expect(kept).toEqual([]);
  });

  it("sem participantes", () => {
    expect(splitSavedParticipants([])).toEqual({ editable: [], kept: [] });
  });
});

describe("finalParticipantIds (RN-13, DT-15)", () => {
  it("Quando acrescenta Bruno a R (Ana; Sara excluída), então o conjunto final é Ana, Bruno e Sara", () => {
    expect(finalParticipantIds(["m1", "m3"], [{ id: "m2", name: "Sara" }])).toEqual(["m1", "m3", "m2"]);
  });

  it("Quando retira todos os escolhidos, então os excluídos continuam", () => {
    expect(finalParticipantIds([], [{ id: "m2", name: "Sara" }])).toEqual(["m2"]);
  });

  it("não repete ids", () => {
    expect(finalParticipantIds(["m1", "m1", "m2"], [{ id: "m2", name: "Sara" }])).toEqual(["m1", "m2"]);
  });

  it("relatório sem excluídos: só os escolhidos", () => {
    expect(finalParticipantIds(["m1"], [])).toEqual(["m1"]);
    expect(finalParticipantIds([], [])).toEqual([]);
  });
});

describe("keptParticipantsLine (T8)", () => {
  it("um excluído", () => {
    expect(keptParticipantsLine([{ id: "m2", name: "Sara Reis" }])).toBe(
      "Continuam no relatório (cadastros excluídos): Sara Reis.",
    );
  });

  it("vários excluídos, em frase", () => {
    expect(
      keptParticipantsLine([
        { id: "a", name: "Ana" },
        { id: "b", name: "Bruno" },
        { id: "c", name: "Sara" },
      ]),
    ).toBe("Continuam no relatório (cadastros excluídos): Ana, Bruno e Sara.");
  });

  it("sem excluídos, não há linha", () => {
    expect(keptParticipantsLine([])).toBeNull();
  });
});

describe("markDeletedChoice (UX-30)", () => {
  const options = [
    { value: "m1", label: "Ana" },
    { value: "m2", label: "Bruno" },
  ];

  it("marca só o membro excluído, que continua escolhido", () => {
    expect(markDeletedChoice(options, "m2")).toEqual([
      { value: "m1", label: "Ana" },
      { value: "m2", label: "Bruno (cadastro excluído)" },
    ]);
  });

  it("marcar de novo não repete a marca", () => {
    expect(markDeletedChoice(markDeletedChoice(options, "m2"), "m2")[1].label).toBe("Bruno (cadastro excluído)");
  });

  it("membro que não está entre os escolhidos: nada muda", () => {
    expect(markDeletedChoice(options, "m9")).toEqual(options);
  });
});

describe("participantes que quem edita não vê (E2.02, T8, UX-27)", () => {
  const formSaved = (member_id: string, member_visible: boolean | null, member_deleted = false) => ({
    member_id,
    member_name: member_id,
    member_deleted,
    member_visible,
  });

  it("são os salvos com member_visible falso, sem os de cadastro excluído", () => {
    expect(
      hiddenParticipantIds([
        formSaved("caio", true),
        formSaved("diego", false),
        formSaved("hugo", false),
        formSaved("excluido", false, true),
        formSaved("sem-info", null),
      ]),
    ).toEqual(["diego", "hugo"]);
  });

  it("o aviso aparece só enquanto algum deles continua escolhido", () => {
    expect(hasHiddenParticipants(["caio", "diego"], ["diego", "hugo"])).toBe(true);
    expect(hasHiddenParticipants(["caio"], ["diego", "hugo"])).toBe(false);
    expect(hasHiddenParticipants([], [])).toBe(false);
  });
});
