import { describe, expect, it } from "vitest";
import {
  leadershipOf,
  leadershipSpokenText,
  leadershipText,
  memberLeadership,
  showsLeadershipOnCard,
  type Leadership,
} from "./leadership";

// P41 e RN-10 do E2.06, com a massa do spec (UX-02, UX-16, UX-18).

const view = (text: Leadership) => ({ text: leadershipText(text), spoken: leadershipSpokenText(text), card: showsLeadershipOnCard(text) });

describe("leadershipOf", () => {
  it("pastor: '—', lido como 'Nenhuma', sem a linha no cartão (Samuel)", () => {
    expect(view(leadershipOf({ level: 0, isPastor: true, leaderName: null, g12Name: null }))).toEqual({
      text: "—",
      spoken: "Nenhuma",
      card: false,
    });
  });

  it("sem liderança: 'Sem liderança', sem a linha no cartão (Ester)", () => {
    expect(view(leadershipOf({ level: null, isPastor: false, leaderName: null, g12Name: null }))).toEqual({
      text: "Sem liderança",
      spoken: "Sem liderança",
      card: false,
    });
  });

  it("G12: o líder direto, que é o pastor ou quem está sem liderança (Pedro, Lúcia)", () => {
    expect(view(leadershipOf({ level: 1, leaderName: "Samuel Colares", g12Name: "Pedro Alves" }))).toEqual({
      text: "Samuel Colares",
      spoken: "Líder Samuel Colares",
      card: true,
    });
    expect(leadershipText(leadershipOf({ level: 1, leaderName: "Ester Ramos", g12Name: "Lúcia Freitas" }))).toBe("Ester Ramos");
  });

  it("nível 2: o líder direto é o G12, um nome só (André)", () => {
    expect(view(leadershipOf({ level: 2, leaderName: "Pedro Alves", g12Name: "Pedro Alves" }))).toEqual({
      text: "Pedro Alves",
      spoken: "G12 e líder Pedro Alves",
      card: true,
    });
  });

  it("nível 3 ou mais: 'G12 / líder', lido sem a barra (Caio, Gabriel, Sônia)", () => {
    expect(view(leadershipOf({ level: 3, leaderName: "André Souza", g12Name: "Pedro Alves" }))).toEqual({
      text: "Pedro Alves / André Souza",
      spoken: "G12 Pedro Alves, líder André Souza",
      card: true,
    });
    expect(leadershipText(leadershipOf({ level: 4, leaderName: "Fábio Lima", g12Name: "Pedro Alves" }))).toBe("Pedro Alves / Fábio Lima");
    expect(leadershipText(leadershipOf({ level: 5, leaderName: "Olga Reis", g12Name: "Tiago Rocha" }))).toBe("Tiago Rocha / Olga Reis");
  });

  it("nível 3 ou mais sem o nome do G12: só o líder direto", () => {
    expect(view(leadershipOf({ level: 3, leaderName: "André Souza", g12Name: null }))).toEqual({
      text: "André Souza",
      spoken: "Líder André Souza",
      card: true,
    });
  });

  it("nunca mais de dois nomes nem o caminho inteiro (UX-18)", () => {
    const text = leadershipText(leadershipOf({ level: 4, leaderName: "Fábio Lima", g12Name: "Pedro Alves" }));
    expect(text.split(" / ")).toHaveLength(2);
    expect(text).not.toContain("Samuel");
  });

  it("sem o nome do líder, '—'", () => {
    expect(leadershipText(leadershipOf({ level: 1, leaderName: null, g12Name: "Pedro Alves" }))).toBe("—");
    expect(leadershipText(leadershipOf({ level: 3, leaderName: "  ", g12Name: "Pedro Alves" }))).toBe("—");
  });
});

describe("memberLeadership", () => {
  it("lê as colunas da members_view (Débora, na lista de André)", () => {
    expect(
      leadershipText(memberLeadership({ g12_level: 3, is_pastor: false, leader_name: "Beatriz Souza", g12_name: "Tânia Rocha" })),
    ).toBe("Tânia Rocha / Beatriz Souza");
  });
});
