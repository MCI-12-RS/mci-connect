import { describe, expect, it } from "vitest";
import {
  EMPTY_CELL_FILTERS,
  cellFilterChips,
  cellListHref,
  clearCellFilters,
  countActiveCellFilters,
  parseCellFilters,
  removeCellFilterChip,
  toCellsListArgs,
  writeCellFilters,
  type CellFilters,
} from "./filters";

const ID = (n: number) => `e2e210f1-0000-0000-0000-${String(n).padStart(12, "0")}`;
const names = { leader: (i: number) => `Líder ${i}`, g12: (i: number) => `G12 ${i}` };

describe("parseCellFilters (E2.10, RN-12, UX-12)", () => {
  it("lê os 10 filtros com os nomes da URL", () => {
    const params = new URLSearchParams(
      `leaders=${ID(1)},${ID(2)}&g12=${ID(3)}&street=Rua&neighborhood=Centro&city=Porto&type=macrocell,evangelistic&day=sun,wed&status=inactive&report_status=missed_4plus,pending&from=2026-11-22&to=2026-11-28`,
    );
    const { filters, cleanParams } = parseCellFilters(params);
    expect(filters).toEqual<CellFilters>({
      leaders: [ID(1), ID(2)],
      g12: [ID(3)],
      street: "Rua",
      neighborhood: "Centro",
      city: "Porto",
      types: ["evangelistic", "macrocell"],
      days: ["wed", "sun"],
      status: "inactive",
      reportStatuses: ["pending", "missed_4plus"],
      from: "2026-11-22",
      to: "2026-11-28",
    });
    // A ordem das opções é reescrita: a URL muda (com `replace`, no hook).
    expect(cleanParams?.get("type")).toBe("evangelistic,macrocell");
    expect(cleanParams?.get("day")).toBe("wed,sun");
  });

  it("valores inválidos saem da URL e não contam; `q`, `page` e `size` ficam", () => {
    const params = new URLSearchParams("type=abc&day=sat&status=todas&report_status=em_dia&leaders=xyz&from=2026-02-31&q=flores&page=2&size=50");
    const { filters, cleanParams } = parseCellFilters(params);
    expect(filters).toEqual({ ...EMPTY_CELL_FILTERS, days: ["sat"] });
    expect(cleanParams?.toString()).toBe("day=sat&q=flores&page=2&size=50");
    expect(countActiveCellFilters(filters)).toBe(1);
  });

  it("URL já limpa: nada a reescrever", () => {
    expect(parseCellFilters(new URLSearchParams("type=evangelistic&size=50")).cleanParams).toBeNull();
  });

  it("acima de 10 pessoas valem as 10 primeiras, com o aviso; repetidos saem", () => {
    const ids = Array.from({ length: 12 }, (_, i) => ID(i + 1));
    const parsed = parseCellFilters(new URLSearchParams(`leaders=${ID(1)},${ids.join(",")}&g12=${ID(5)}`));
    expect(parsed.filters.leaders).toEqual(ids.slice(0, 10));
    expect(parsed.leadersTruncated).toBe(true);
    expect(parsed.g12Truncated).toBe(false);
    expect(parsed.cleanParams?.get("leaders")).toBe(ids.slice(0, 10).join(","));
  });

  it("textos: sem espaços nas pontas, até 100 caracteres; só espaços some", () => {
    const long = "a".repeat(120);
    const { filters } = parseCellFilters(new URLSearchParams(`street=  São João  &city=${long}&neighborhood=%20%20`));
    expect(filters.street).toBe("São João");
    expect(filters.city).toHaveLength(100);
    expect(filters.neighborhood).toBeNull();
  });

  it("datas invertidas ficam na URL, mas não valem nem contam (DA-7)", () => {
    const parsed = parseCellFilters(new URLSearchParams("from=2026-11-28&to=2026-11-22"));
    expect(parsed.dateRangeInverted).toBe(true);
    expect(countActiveCellFilters(parsed.filters)).toBe(0);
    expect(toCellsListArgs(parsed.filters, "")).toEqual({});
  });
});

describe("writeCellFilters e clearCellFilters", () => {
  it("grava sem os padrões, na ordem das opções, pessoas na ordem da escolha, e volta para a página 1", () => {
    const next = writeCellFilters(new URLSearchParams("q=flores&page=3&size=50"), {
      ...EMPTY_CELL_FILTERS,
      leaders: [ID(2), ID(1)],
      days: ["sun", "mon"],
      reportStatuses: ["missed_1", "sent"],
    });
    expect(next.toString()).toBe(`q=flores&size=50&leaders=${encodeURIComponent(`${ID(2)},${ID(1)}`)}&day=mon%2Csun&report_status=sent%2Cmissed_1`);
  });

  it("Limpar filtros (UX-07): só `size` fica", () => {
    const params = new URLSearchParams("type=evangelistic&status=active&from=2026-11-01&q=flores&page=2&size=50");
    expect(clearCellFilters(params).toString()).toBe("size=50");
  });
});

describe("countActiveCellFilters (RN-12, UX-05)", () => {
  it("o critério da RN-12: Líder (2), G12, Tipo (2), Situação e as duas datas contam 5", () => {
    const filters: CellFilters = {
      ...EMPTY_CELL_FILTERS,
      leaders: [ID(1), ID(2)],
      g12: [ID(3)],
      types: ["evangelistic", "discipleship"],
      status: "active",
      from: "2026-11-01",
      to: "2026-11-30",
    };
    expect(countActiveCellFilters(filters)).toBe(5);
    expect(cellFilterChips(filters, names)).toHaveLength(8);
    expect(countActiveCellFilters(removeCellFilterChip(filters, "type:discipleship"))).toBe(5);
  });

  it("os 10 contam 10; sem nada, 0", () => {
    const all: CellFilters = {
      leaders: [ID(1)],
      g12: [ID(2)],
      street: "a",
      neighborhood: "b",
      city: "c",
      types: ["macrocell"],
      days: ["mon"],
      status: "active",
      reportStatuses: ["pending"],
      from: "2026-11-01",
      to: null,
    };
    expect(countActiveCellFilters(all)).toBe(10);
    expect(countActiveCellFilters(EMPTY_CELL_FILTERS)).toBe(0);
  });
});

describe("cellFilterChips (UXD-1, UX-06, UX-10, UX-11)", () => {
  it("um chip por valor, na ordem dos campos, com os textos do Negócio", () => {
    const filters: CellFilters = {
      leaders: [ID(1)],
      g12: [ID(2), ID(3)],
      street: "Rua das Flores",
      neighborhood: "Centro",
      city: "Porto Alegre",
      types: ["discipleship"],
      days: ["wed"],
      status: "inactive",
      reportStatuses: ["sent", "missed_1", "missed_4plus"],
      from: "2026-11-22",
      to: "2026-11-28",
    };
    expect(cellFilterChips(filters, names).map((chip) => chip.text)).toEqual([
      "Líder: Líder 0",
      "G12: G12 0",
      "G12: G12 1",
      "Rua: Rua das Flores",
      "Bairro: Centro",
      "Cidade: Porto Alegre",
      "Tipo: Discipulado",
      "Dia: Quarta-feira",
      "Situação: Inativa",
      "Situação do relatório: Enviado",
      "Situação do relatório: Sem relatório na semana passada",
      "Situação do relatório: Sem relatório nas 4 ou mais semanas anteriores",
      "Cadastrada a partir de 22/11/2026",
      "Cadastrada até 28/11/2026",
    ]);
  });

  it("as chaves das pessoas são a posição, nunca o id (UX-09)", () => {
    const chips = cellFilterChips({ ...EMPTY_CELL_FILTERS, g12: [ID(7)] }, names);
    expect(chips[0].key).toBe("g12:0");
    expect(JSON.stringify(chips)).not.toContain(ID(7));
  });

  it("tirar um chip tira só aquele valor", () => {
    const filters: CellFilters = { ...EMPTY_CELL_FILTERS, g12: [ID(1), ID(2)], reportStatuses: ["pending", "missed_2"], street: "x" };
    expect(removeCellFilterChip(filters, "g12:0").g12).toEqual([ID(2)]);
    expect(removeCellFilterChip(filters, "report_status:pending").reportStatuses).toEqual(["missed_2"]);
    expect(removeCellFilterChip(filters, "street").street).toBeNull();
  });
});

describe("toCellsListArgs (mapa da URL para os parâmetros, AQ-1)", () => {
  it("sem filtros nem busca, nenhum argumento", () => {
    expect(toCellsListArgs(EMPTY_CELL_FILTERS, "  ")).toEqual({});
  });

  it("cada filtro vira o parâmetro da RPC", () => {
    const args = toCellsListArgs(
      {
        leaders: [ID(1)],
        g12: [ID(2)],
        street: "Rua",
        neighborhood: "Centro",
        city: "Porto",
        types: ["evangelistic", "discipleship", "macrocell"],
        days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
        status: "inactive",
        reportStatuses: ["sent", "not_yet", "pending", "next_week", "missed_1", "missed_2", "missed_3", "missed_4plus"],
        from: "2026-11-22",
        to: "2026-11-28",
      },
      "flores",
    );
    expect(args).toEqual({
      _search: ["%flores%"],
      _leader_ids: [ID(1)],
      _g12_ids: [ID(2)],
      _street: "Rua",
      _neighborhood: "Centro",
      _city: "Porto",
      _types: ["Evangelística", "Discipulado", "Macrocélula"],
      _weekdays: [1, 2, 3, 4, 5, 6, 0],
      _is_active: false,
      _report_statuses: ["sent_held", "sent_not_held", "not_yet", "pending", "next_week"],
      _missing_weeks: [1, 2, 3, 4],
      _created_from: "2026-11-22",
      _created_to: "2026-11-28",
    });
  });
});

describe("cellListHref (RN-21, links prontos para o E2.14)", () => {
  it("os quatro cards", () => {
    expect(cellListHref({ kind: "pending" })).toBe("/cells?report_status=pending");
    expect(cellListHref({ kind: "type", type: "Evangelística" })).toBe("/cells?type=evangelistic");
    expect(cellListHref({ kind: "type", type: "Discipulado", activeOnly: true })).toBe("/cells?type=discipleship&status=active");
    expect(cellListHref({ kind: "new_this_week", week: { start: "2026-11-22", end: "2026-11-28" } })).toBe(
      "/cells?from=2026-11-22&to=2026-11-28",
    );
    expect(cellListHref({ kind: "g12_couple", ids: [ID(1), ID(2)] })).toBe(
      `/cells?g12=${encodeURIComponent(`${ID(1)},${ID(2)}`)}&status=active`,
    );
  });
});
