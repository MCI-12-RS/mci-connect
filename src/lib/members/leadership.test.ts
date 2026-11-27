// E2.04 (RN-11, RN-12, RN-16; P20, P-VAL-22, P-VAL-23; UX-16 a UX-18): os
// interruptores escondem o valor e o devolvem; nada é apagado em silêncio.
import { describe, expect, it } from "vitest";
import {
  initialMinistrySwitches,
  ministrySwitchNotices,
  ministrySwitchValues,
  setBaptismDate,
  setBaptized,
  setHasLeadership,
  setLeader,
  setPastor,
} from "./leadership";
import { MEMBER_HINT_TEXTS } from "./texts";

const PEDRO = { id: "pedro", name: "Pedro Alves" };

const andre = () =>
  initialMinistrySwitches({ is_pastor: false, has_leadership: true, leader: PEDRO, is_baptized: true, baptism_date: "2020-05-10" });

describe("cadastro novo (RN-12, P-VAL-12)", () => {
  it("começa com \"Tem Liderança?\" ligado e sem líder", () => {
    const { state } = initialMinistrySwitches(null);
    expect(state).toEqual({ is_pastor: false, has_leadership: true, leader: null, is_baptized: false, baptism_date: null });
    expect(ministrySwitchNotices(initialMinistrySwitches(null))).toEqual({ pastor: [], leadership: [], baptism: [] });
  });
});

describe("\"É Pastor(a)?\" (UX-16, UX-18)", () => {
  it("ligar esconde o líder, avisa e não apaga nada antes de salvar", () => {
    const on = setPastor(andre(), true);
    expect(ministrySwitchValues(on)).toMatchObject({ is_pastor: true, has_leadership: false, leader_id: null });
    expect(ministrySwitchNotices(on, PEDRO).pastor).toEqual([
      { kind: "text", text: MEMBER_HINT_TEXTS.pastorHasNoLeader },
      { kind: "warning", text: "Ao salvar, Pedro Alves deixa de ser o líder." },
    ]);
  });

  it("desligar antes de salvar devolve Pedro, com \"Tem Liderança?\" ligado", () => {
    const back = setPastor(setPastor(andre(), true), false);
    expect(back.state).toEqual(andre().state);
    expect(ministrySwitchNotices(back)).toEqual({ pastor: [], leadership: [], baptism: [] });
  });

  it("UX-18: no cadastro de Samuel (pastor), desligar mostra \"Tem Liderança?\" ligado e o Líder vazio", () => {
    const samuel = initialMinistrySwitches({ is_pastor: true, has_leadership: false, leader: null, is_baptized: false, baptism_date: null });
    const off = setPastor(samuel, false);
    expect(off.state).toMatchObject({ is_pastor: false, has_leadership: true, leader: null });
  });

  it("sem líder, só o texto, sem aviso", () => {
    const on = setPastor(initialMinistrySwitches(null), true);
    expect(ministrySwitchNotices(on).pastor).toEqual([{ kind: "text", text: MEMBER_HINT_TEXTS.pastorHasNoLeader }]);
  });

  it("\"Tem Liderança?\" desligado com Pedro escondido: ligar e desligar pastor mantém o aviso do líder", () => {
    const noLeadership = setHasLeadership(andre(), false);
    const pastor = setPastor(noLeadership, true);
    expect(ministrySwitchNotices(pastor, PEDRO).pastor[1]).toEqual({ kind: "warning", text: MEMBER_HINT_TEXTS.leaderRemoved("Pedro Alves") });
    const back = setPastor(pastor, false);
    expect(back.state).toMatchObject({ has_leadership: false, leader: null });
    expect(ministrySwitchNotices(back, PEDRO).leadership).toEqual([
      { kind: "warning", text: MEMBER_HINT_TEXTS.leaderRemovedNoLeadership("Pedro Alves") },
    ]);
  });

  it("líder gravado sem nome: nenhum aviso com o nome em branco, só os textos de situação", () => {
    const nameless = { ...PEDRO, name: "  " };
    const pastor = setPastor(andre(), true);
    expect(ministrySwitchNotices(pastor, nameless).pastor).toEqual([{ kind: "text", text: MEMBER_HINT_TEXTS.pastorHasNoLeader }]);
    const noLeadership = setHasLeadership(andre(), false);
    expect(ministrySwitchNotices(noLeadership, nameless).leadership).toEqual([
      { kind: "hint", text: MEMBER_HINT_TEXTS.noLeadership },
    ]);
  });

  it("ligar de novo o que já está ligado não muda nada", () => {
    const state = andre();
    expect(setPastor(state, false)).toEqual(state);
  });
});

describe("\"Tem Liderança?\" (UX-17)", () => {
  it("desligar com líder avisa com o nome; religar devolve o líder", () => {
    const off = setHasLeadership(andre(), false);
    expect(ministrySwitchValues(off)).toMatchObject({ has_leadership: false, leader_id: null });
    expect(ministrySwitchNotices(off, PEDRO).leadership).toEqual([
      { kind: "warning", text: "Ao salvar, Pedro Alves deixa de ser o líder. A pessoa fica sem liderança." },
    ]);
    const on = setHasLeadership(off, true);
    expect(on.state.leader).toEqual(PEDRO);
  });

  it("desligar sem líder mostra só a dica", () => {
    const off = setHasLeadership(initialMinistrySwitches(null), false);
    expect(ministrySwitchNotices(off).leadership).toEqual([{ kind: "hint", text: MEMBER_HINT_TEXTS.noLeadership }]);
  });

  it("escolher um líder liga \"Tem Liderança?\" e descarta o guardado", () => {
    const off = setHasLeadership(andre(), false);
    const chosen = setLeader(off, { id: "rita", name: "Rita" });
    expect(chosen.state).toMatchObject({ has_leadership: true, leader: { id: "rita", name: "Rita" } });
    expect(chosen.memory.leader).toBeNull();
    expect(ministrySwitchValues(chosen).leader_id).toBe("rita");
  });
});

describe("\"Batizado(a)?\" (RN-16, UX-17)", () => {
  it("desligar avisa com a data em dd/mm/aaaa e manda a data vazia; religar a devolve", () => {
    const off = setBaptized(andre(), false);
    expect(ministrySwitchValues(off)).toMatchObject({ is_baptized: false, baptism_date: null });
    expect(ministrySwitchNotices(off).baptism).toEqual([
      { kind: "warning", text: "Ao salvar, a data do batismo (10/05/2020) será apagada." },
    ]);
    expect(setBaptized(off, true).state.baptism_date).toBe("2020-05-10");
  });

  it("sem data, desligar não avisa", () => {
    const off = setBaptized(setBaptismDate(andre(), null), false);
    expect(ministrySwitchNotices(off).baptism).toEqual([]);
  });
});

describe("E2.07 (RN-16, UXD-11): o aviso do P20 fala só do líder gravado", () => {
  const prefilled = () => setLeader(initialMinistrySwitches(null), { id: "rita", name: "Rita Gomes" });

  it("cadastro novo com o líder preenchido: ligar \"É Pastor(a)?\" mostra só o texto de situação", () => {
    const on = setPastor(prefilled(), true);
    expect(ministrySwitchNotices(on).pastor).toEqual([{ kind: "text", text: MEMBER_HINT_TEXTS.pastorHasNoLeader }]);
    // Desfazer devolve o líder que estava no campo.
    expect(setPastor(on, false).state.leader).toEqual({ id: "rita", name: "Rita Gomes" });
  });

  it("cadastro novo: desligar \"Tem Liderança?\" mostra só \"A pessoa fica sem liderança.\"", () => {
    const off = setHasLeadership(prefilled(), false);
    expect(ministrySwitchNotices(off).leadership).toEqual([{ kind: "hint", text: MEMBER_HINT_TEXTS.noLeadership }]);
    expect(setHasLeadership(off, true).state.leader).toEqual({ id: "rita", name: "Rita Gomes" });
  });

  it("edição: trocar o líder e ligar \"É Pastor(a)?\" avisa sobre o gravado", () => {
    const changed = setPastor(setLeader(andre(), { id: "paula", name: "Paula Alves" }), true);
    expect(ministrySwitchNotices(changed, PEDRO).pastor[1]).toEqual({
      kind: "warning",
      text: MEMBER_HINT_TEXTS.leaderRemoved("Pedro Alves"),
    });
  });
});
