import { describe, expect, it } from "vitest";
import { Constants } from "@/integrations/supabase/types";
import {
  EMPTY_MEMBER_FILTERS,
  MAX_LEADERS,
  clearMemberFilters,
  countActiveFilters,
  memberFilterChips,
  memberListHref,
  normalizeFilterText,
  parseMemberFilters,
  removeMemberFilterChip,
  resolveLeaderLabel,
  toMembersListArgs,
  writeMemberFilters,
  type MemberFilters,
} from "./filters";
import { MEMBER_CELL_LINK_LABELS, MEMBER_LEADERSHIP_LABELS, MEMBER_LEVEL_LABELS } from "./filter-texts";

const uuid = (n: number) => `e2e207f1-0001-0000-0000-${String(n).padStart(12, "0")}`;
const PEDRO = uuid(3);
const ANDRE = uuid(7);
const filtersOf = (changes: Partial<MemberFilters>): MemberFilters => ({ ...EMPTY_MEMBER_FILTERS, ...changes });
const parse = (query: string) => parseMemberFilters(new URLSearchParams(query));

describe("parseMemberFilters (RN-14, AQ-1)", () => {
  it("URL sem filtros: nada a limpar", () => {
    const parsed = parse("q=ana&page=2&size=50");
    expect(parsed.filters).toEqual(EMPTY_MEMBER_FILTERS);
    expect(parsed.cleanParams).toBeNull();
  });

  it("lê os 9 filtros com os nomes confirmados", () => {
    const parsed = parse(
      `leaders=${PEDRO},${ANDRE}&neighborhood=Centro&city=Canoas&status=active&leadership=pastor,with_leader&baptized=no&level=5plus,0&cell_link=none,leader&from=2026-11-22&to=2026-11-28`,
    );
    expect(parsed.filters).toEqual({
      leaders: [PEDRO, ANDRE],
      neighborhood: "Centro",
      city: "Canoas",
      status: "active",
      leadership: ["with_leader", "pastor"],
      baptized: "no",
      levels: ["0", "5plus"],
      cellLinks: ["leader", "none"],
      from: "2026-11-22",
      to: "2026-11-28",
    });
    // A ordem das opções vai para a URL limpa; a Liderança mantém a ordem da escolha.
    expect(parsed.cleanParams?.get("leadership")).toBe("with_leader,pastor");
    expect(parsed.cleanParams?.get("leaders")).toBe(`${PEDRO},${ANDRE}`);
  });

  it("critério da RN-14: com level=abc&baptized=yes, level sai e só Batizado: Sim vale", () => {
    const parsed = parse("level=abc&baptized=yes");
    expect(parsed.filters).toEqual(filtersOf({ baptized: "yes" }));
    expect(parsed.cleanParams?.toString()).toBe("baptized=yes");
    expect(countActiveFilters(parsed.filters)).toBe(1);
  });

  it("valores inválidos saem: data que não existe, opção desconhecida, id malformado (P-FIL-18)", () => {
    const parsed = parse("from=2026-02-31&status=todos&leaders=nao-e-id&cell_link=x&q=ana");
    expect(parsed.filters).toEqual(EMPTY_MEMBER_FILTERS);
    expect(parsed.cleanParams?.toString()).toBe("q=ana");
  });

  it("mais de 10 pessoas: as 10 primeiras distintas, na ordem, e o aviso (RN-04, DA-2)", () => {
    const ids = Array.from({ length: 12 }, (_, i) => uuid(i + 1));
    const parsed = parse(`leaders=${[ids[0], ids[0], ...ids].join(",")}`);
    expect(parsed.filters.leaders).toEqual(ids.slice(0, MAX_LEADERS));
    expect(parsed.leadersTruncated).toBe(true);
    expect(parsed.cleanParams?.get("leaders")).toBe(ids.slice(0, MAX_LEADERS).join(","));
  });

  it("bairro só com espaços sai; com mais de 100 caracteres, os 100 primeiros", () => {
    expect(parse("neighborhood=%20%20").filters.neighborhood).toBeNull();
    expect(parse(`city=${"a".repeat(120)}`).filters.city).toHaveLength(100);
  });

  it("datas invertidas ficam na URL, mas não valem, não contam e não viram chip (DA-4)", () => {
    const parsed = parse("from=2026-11-25&to=2026-11-20");
    expect(parsed.cleanParams).toBeNull();
    expect(parsed.dateRangeInverted).toBe(true);
    expect(countActiveFilters(parsed.filters)).toBe(0);
    expect(memberFilterChips(parsed.filters, () => "")).toEqual([]);
    expect(toMembersListArgs(parsed.filters, "")).toEqual({});
  });
});

describe("writeMemberFilters e clearMemberFilters", () => {
  it("grava sem os padrões e volta para a página 1, mantendo busca e tamanho", () => {
    const next = writeMemberFilters(new URLSearchParams("q=ana&page=3&size=50"), filtersOf({ status: "inactive" }));
    expect(next.toString()).toBe("q=ana&size=50&status=inactive");
  });

  it("Limpar filtros: só o tamanho fica (critério da RN-14)", () => {
    const params = new URLSearchParams("status=active&baptized=no&cell_link=none&q=ana&page=2&size=50");
    expect(clearMemberFilters(params).toString()).toBe("size=50");
  });
});

describe("countActiveFilters (P-FIL-19, UX-05)", () => {
  it("Liderança com 3 pessoas conta 1, as duas datas contam 1, a busca não conta", () => {
    const filters = filtersOf({ leaders: [uuid(1), uuid(2), uuid(3)], from: "2026-11-22", to: "2026-11-28" });
    expect(countActiveFilters(filters)).toBe(2);
  });

  it("o equivalente de Sem Liderança (RN-17) conta 2; os 9 filtros contam 9", () => {
    expect(countActiveFilters(filtersOf({ status: "active", leadership: ["no_leadership"] }))).toBe(2);
    expect(
      countActiveFilters({
        leaders: [PEDRO],
        neighborhood: "a",
        city: "b",
        status: "active",
        leadership: ["pastor"],
        baptized: "yes",
        levels: ["1"],
        cellLinks: ["none"],
        from: "2026-01-01",
        to: null,
      }),
    ).toBe(9);
  });

  it("múltipla escolha com todas as opções marcadas conta (DA-8)", () => {
    expect(countActiveFilters(filtersOf({ levels: ["0", "1", "2", "3", "4", "5plus"] }))).toBe(1);
  });
});

describe("memberFilterChips (UX-06, UXD-5)", () => {
  it("um chip por valor, na ordem dos campos; a chave da Liderança é a posição, nunca o id (UX-09)", () => {
    const filters = filtersOf({ leaders: [PEDRO, ANDRE], status: "active", levels: ["2", "3"] });
    const chips = memberFilterChips(filters, (i) => ["Pedro Alves", "Paula Alves"][i]!);
    expect(chips).toEqual([
      { key: "leaders:0", text: "Liderança: Pedro Alves" },
      { key: "leaders:1", text: "Liderança: Paula Alves" },
      { key: "status", text: "Situação: Ativo" },
      { key: "level:2", text: "Nível: 144" },
      { key: "level:3", text: "Nível: 1.728" },
    ]);
    expect(JSON.stringify(chips)).not.toContain(PEDRO);
  });

  it("datas: 'Cadastrado a partir de dd/mm/aaaa' e 'Cadastrado até dd/mm/aaaa' (UX-10)", () => {
    const chips = memberFilterChips(filtersOf({ from: "2026-11-22", to: "2026-11-28" }), () => "");
    expect(chips.map((chip) => chip.text)).toEqual(["Cadastrado a partir de 22/11/2026", "Cadastrado até 28/11/2026"]);
  });

  it("o ✕ tira só aquele valor", () => {
    const filters = filtersOf({ leaders: [PEDRO, ANDRE], cellLinks: ["leader", "none"], status: "active" });
    expect(removeMemberFilterChip(filters, "leaders:0").leaders).toEqual([ANDRE]);
    expect(removeMemberFilterChip(filters, "cell_link:none").cellLinks).toEqual(["leader"]);
    expect(removeMemberFilterChip(filters, "status").status).toBeNull();
  });
});

describe("toMembersListArgs (DT-01)", () => {
  it("só os filtros em uso; 5plus vira 5; a busca vira padrões ILIKE", () => {
    const args = toMembersListArgs(
      filtersOf({ status: "inactive", baptized: "yes", levels: ["1", "5plus"], neighborhood: " São João " }),
      "Ana",
    );
    expect(args).toEqual({ _search: ["%ana%"], _is_active: false, _is_baptized: true, _levels: [1, 5], _neighborhood: "São João" });
  });

  it("sem filtros e sem busca: nenhum argumento", () => {
    expect(toMembersListArgs(EMPTY_MEMBER_FILTERS, "  ")).toEqual({});
  });
});

describe("memberListHref (RN-17, para o E2.14)", () => {
  it("os equivalentes dos cards", () => {
    expect(memberListHref("total")).toBe("/members");
    expect(memberListHref("no_cell_link")).toBe("/members?status=active&cell_link=none");
    expect(memberListHref("no_leadership")).toBe("/members?status=active&leadership=no_leadership");
    expect(memberListHref("not_baptized")).toBe("/members?baptized=no");
    expect(memberListHref("new_this_week", { start: "2026-11-22", end: "2026-11-28" })).toBe("/members?from=2026-11-22&to=2026-11-28");
  });
});

describe("resolveLeaderLabel (RN-05, P53)", () => {
  const visible = new Map([[PEDRO, "Pedro Alves"]]);
  it("visível pelo nome; fora da leitura, 'Pessoa indisponível', sem nome", () => {
    expect(resolveLeaderLabel(PEDRO, { picked: new Map(), visible, failed: false })).toEqual({ label: "Pedro Alves", unavailable: false });
    expect(resolveLeaderLabel(ANDRE, { picked: new Map(), visible, failed: false })).toEqual({ label: "Pessoa indisponível", unavailable: true });
  });

  it("carregando, falha e escolhida agora", () => {
    expect(resolveLeaderLabel(PEDRO, { picked: new Map(), visible: undefined, failed: false }).label).toBe("Carregando…");
    expect(resolveLeaderLabel(PEDRO, { picked: new Map(), visible: undefined, failed: true }).label).toBe("nome não carregado");
    expect(resolveLeaderLabel(ANDRE, { picked: new Map([[ANDRE, "André Souza"]]), visible, failed: false }).label).toBe("André Souza");
  });
});

describe("filter-texts (DT-08)", () => {
  it("toda opção dos enums tem rótulo", () => {
    for (const value of Constants.public.Enums.member_cell_link) expect(MEMBER_CELL_LINK_LABELS[value]).toBeTruthy();
    for (const value of Constants.public.Enums.member_leadership_status) expect(MEMBER_LEADERSHIP_LABELS[value]).toBeTruthy();
  });

  it("os rótulos de nível do P40, com 'Pastores' e 'Nível 5 ou mais', sem '12' sozinho (UX-02)", () => {
    expect(Object.values(MEMBER_LEVEL_LABELS)).toEqual(["Pastores", "G12", "144", "1.728", "20.736", "Nível 5 ou mais"]);
  });

  it("normalizeFilterText", () => {
    expect(normalizeFilterText("  Centro  ")).toBe("Centro");
    expect(normalizeFilterText("")).toBeNull();
  });
});
