import { describe, it, expect } from "vitest";
import type { AppError } from "@/lib/errors";
import {
  BLOCKER_GROUP_LIMIT,
  buildBlockerGroups,
  formatLinkedCell,
  formatLinkedDisciple,
  memberLinksFromRefusal,
  parseMemberLinks,
  type LinkedCell,
  type MemberLinks,
} from "./blockers";

// Bloqueio da exclusão de um membro com ligações (E2.01, RN-04, T3 e UX-09).

const disciple = (id: string, name: string | null, is_active = true) => ({ id, name, is_active });

const cell = (overrides: Partial<LinkedCell>): LinkedCell => ({
  id: "c1",
  roles: ["timothy"],
  leader_name: "Carlos Lima",
  meeting_day: "Quarta",
  meeting_time: "20:00",
  is_active: true,
  ...overrides,
});

/** O caso de Gil do critério da RN-04: 4 discípulos (Léo inativo) e 2 células (a de Marcos inativa). */
const gil: MemberLinks = {
  member_id: "g1",
  member_name: "Gil Souza",
  disciples_total: 4,
  disciples: [
    disciple("h1", "Hugo Lima"),
    disciple("i1", "Ivo Reis"),
    disciple("j1", "João Alves"),
    disciple("l1", "Léo Martins", false),
  ],
  cells_total: 2,
  cells: [
    cell({ id: "c1", roles: ["timothy"], leader_name: "Carlos Lima", meeting_day: "Quarta", meeting_time: "20:00" }),
    cell({
      id: "c2",
      roles: ["host"],
      leader_name: "Marcos Dias",
      meeting_day: "Sexta",
      meeting_time: "19:30",
      is_active: false,
    }),
  ],
};

const refusal = (code: string, detail: object): AppError => ({
  code,
  message: "Não é possível excluir Gil Souza. Antes, reatribua 4 discípulos e 2 células.",
  detail: { code, ...detail },
});

describe("buildBlockerGroups", () => {
  it("Dado o caso de Gil, então lista 4 discípulos (Léo inativo) e 2 células, com papel, dia e hora (RN-04)", () => {
    expect(buildBlockerGroups(gil)).toEqual([
      {
        kind: "disciples",
        title: "4 discípulos",
        items: [
          { id: "h1", label: "Hugo Lima" },
          { id: "i1", label: "Ivo Reis" },
          { id: "j1", label: "João Alves" },
          { id: "l1", label: "Léo Martins (inativo)" },
        ],
        more: null,
      },
      {
        kind: "cells",
        title: "2 células",
        items: [
          { id: "c1", label: "Timóteo na célula de Carlos Lima, quarta, 20:00" },
          { id: "c2", label: "Anfitrião na célula de Marcos Dias, sexta, 19:30 (inativa)" },
        ],
        more: null,
      },
    ]);
  });

  it("Dados 7 discípulos (o servidor manda 5), então mostra 5 nomes e 'e mais 2' (UX-09)", () => {
    const names = ["Ana", "Bia", "Caio", "Dani", "Edu"];
    const [group] = buildBlockerGroups({
      ...gil,
      disciples_total: 7,
      disciples: names.map((name, i) => disciple(`d${i}`, name)),
      cells_total: 0,
      cells: [],
    });
    expect(group.title).toBe("7 discípulos");
    expect(group.items.map((item) => item.label)).toEqual(names);
    expect(group.more).toBe("e mais 2");
  });

  it("Dados mais de 5 itens na lista, então mostra só 5 e conta o resto em 'e mais N'", () => {
    const [group] = buildBlockerGroups({
      ...gil,
      disciples_total: 6,
      disciples: ["a", "b", "c", "d", "e", "f"].map((id) => disciple(id, id.toUpperCase())),
      cells_total: 0,
      cells: [],
    });
    expect(group.items).toHaveLength(BLOCKER_GROUP_LIMIT);
    expect(group.more).toBe("e mais 1");
  });

  it("Dado 1 item em cada grupo, então usa o singular", () => {
    const groups = buildBlockerGroups({ ...gil, disciples_total: 1, disciples: [disciple("h1", "Hugo")], cells_total: 1, cells: [cell({})] });
    expect(groups.map((group) => group.title)).toEqual(["1 discípulo", "1 célula"]);
  });

  it("Dado um grupo vazio, então ele não aparece", () => {
    expect(buildBlockerGroups({ ...gil, disciples_total: 0, disciples: [] }).map((g) => g.kind)).toEqual(["cells"]);
    expect(buildBlockerGroups({ ...gil, cells_total: 0, cells: [] }).map((g) => g.kind)).toEqual(["disciples"]);
    expect(buildBlockerGroups({ ...gil, disciples_total: 0, disciples: [], cells_total: 0, cells: [] })).toEqual([]);
  });
});

describe("formatLinkedDisciple e formatLinkedCell", () => {
  it("Dado um discípulo sem nome, então usa o rótulo de membro sem nome", () => {
    expect(formatLinkedDisciple(disciple("x", null))).toBe("Membro sem nome");
    expect(formatLinkedDisciple(disciple("x", null, false))).toBe("Membro sem nome (inativo)");
  });

  it("Dado o membro em mais de um papel, então junta os papéis no começo da frase", () => {
    expect(formatLinkedCell(cell({ roles: ["leader", "host"], leader_name: "Gil Souza" }))).toBe(
      "Líder e anfitrião na célula de Gil Souza, quarta, 20:00",
    );
    expect(formatLinkedCell(cell({ roles: ["leader", "timothy", "host"] }))).toBe(
      "Líder, timóteo e anfitrião na célula de Carlos Lima, quarta, 20:00",
    );
  });

  it("Dado cada dia da semana, então o dia aparece em minúsculas no meio da frase", () => {
    expect(formatLinkedCell(cell({ roles: ["leader"], meeting_day: "Sábado", meeting_time: "09:00" }))).toBe(
      "Líder na célula de Carlos Lima, sábado, 09:00",
    );
    expect(formatLinkedCell(cell({ meeting_day: "Domingo" }))).toContain(", domingo, ");
  });

  it("Dada uma célula sem dia, sem hora ou sem nome do líder, então omite o que falta", () => {
    expect(formatLinkedCell(cell({ meeting_day: null, meeting_time: null }))).toBe("Timóteo na célula de Carlos Lima");
    expect(formatLinkedCell(cell({ leader_name: null }))).toBe("Timóteo na célula de Membro sem nome, quarta, 20:00");
    expect(formatLinkedCell(cell({ meeting_time: "20:00:00" }))).toBe("Timóteo na célula de Carlos Lima, quarta, 20:00");
  });
});

describe("parseMemberLinks e memberLinksFromRefusal", () => {
  it("Dados os detalhes de member_has_links, então lê as ligações", () => {
    expect(memberLinksFromRefusal(refusal("member_has_links", gil))).toEqual(gil);
  });

  it("Dada outra recusa (próprio cadastro, função acima), então não há ligações", () => {
    expect(memberLinksFromRefusal(refusal("self_delete", {}))).toBeNull();
    expect(memberLinksFromRefusal(refusal("role_above", gil))).toBeNull();
  });

  it("Dados detalhes incompletos ou num formato inesperado, então devolve null (a tela mostra a mensagem)", () => {
    const broken: object[] = [
      {},
      { ...gil, member_id: undefined },
      { ...gil, disciples_total: "4" },
      { ...gil, disciples_total: -1 },
      { ...gil, disciples: null },
      { ...gil, disciples: [{ id: "h1", name: "Hugo" }] },
      { ...gil, cells: [{ ...gil.cells[0], roles: ["owner"] }] },
      { ...gil, cells: [{ ...gil.cells[0], roles: "timothy" }] },
      { ...gil, cells: [{ ...gil.cells[0], is_active: "sim" }] },
      { ...gil, cells: [{ ...gil.cells[0], meeting_time: 2000 }] },
    ];
    for (const detail of broken) expect(parseMemberLinks({ code: "member_has_links", ...detail })).toBeNull();
  });
});
