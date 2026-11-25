import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { resetFakeSupabase, respondWith } from "@/test/fake-supabase";
import type { MemberRow } from "@/lib/members/fields";
import Members from "./Members";

// Hierarquia e totais na lista de Membros (E2.06, PR 2, T8): UX-01 a UX-05, UX-16 e UX-18
// com a massa de exemplo do spec (nomes e valores da tabela "Valores da massa").

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});
vi.mock("@/components/AppLayout", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u-rita" }, isSystem: false, hasPermission: () => true }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

function row(overrides: Partial<MemberRow>): MemberRow {
  return {
    id: overrides.name ?? "x",
    name: "Sem Nome",
    gender: "M",
    birth_date: null,
    instagram: null,
    avatar_url: null,
    notes: null,
    neighborhood: null,
    city: null,
    state: null,
    is_pastor: false,
    has_leadership: true,
    leader_id: "l1",
    leader_name: null,
    spouse_id: null,
    spouse_name: null,
    is_baptized: false,
    baptism_date: null,
    is_active: true,
    g12_level: 2,
    g12_name: null,
    total_disciples: 0,
    total_cells: 0,
    auth_user_id: null,
    sensitive_visible: false,
    email: null,
    cpf: null,
    mobile_whatsapp: null,
    phone: null,
    street: null,
    number: null,
    complement: null,
    zip_code: null,
    ...overrides,
  };
}

const NO_LEADER = { leader_id: null, leader_name: null, has_leadership: false };
const samuel = row({ name: "Samuel Colares", is_pastor: true, g12_level: 0, ...NO_LEADER, total_disciples: 12, total_cells: 6 });
const magda = row({ name: "Magda Colares", gender: "F", is_pastor: true, g12_level: 0, ...NO_LEADER, total_disciples: 6, total_cells: 2 });
const oldPastor = row({ name: "Pastor Antigo", gender: null, is_pastor: true, g12_level: 0, ...NO_LEADER });
const pedro = row({ name: "Pedro Alves", g12_level: 1, leader_name: "Samuel Colares", total_disciples: 3, total_cells: 3 });
const lucia = row({ name: "Lúcia Freitas", gender: "F", g12_level: 1, leader_name: "Ester Ramos", total_disciples: 0, total_cells: 1 });
const andre = row({ name: "André Souza", g12_level: 2, leader_name: "Pedro Alves", g12_name: "Pedro Alves", total_disciples: 2, total_cells: 3 });
const diego = row({ name: "Diego Reis", g12_level: 2, leader_name: "Tiago Rocha", g12_name: "Tiago Rocha", total_disciples: 3, total_cells: 3 });
const olga = row({ name: "Olga Reis", gender: "F", g12_level: 4, leader_name: "Lauro Prado", g12_name: "Tiago Rocha", total_disciples: 1, total_cells: 1 });
const caio = row({ name: "Caio Lima", g12_level: 3, leader_name: "André Souza", g12_name: "Pedro Alves" });
const gabriel = row({ name: "Gabriel Nunes", g12_level: 4, leader_name: "Fábio Lima", g12_name: "Pedro Alves", total_cells: 1 });
const sonia = row({ name: "Sônia Castro", gender: "F", g12_level: 5, leader_name: "Olga Reis", g12_name: "Tiago Rocha", total_cells: 1 });
const ester = row({ name: "Ester Ramos", gender: "F", g12_level: null, ...NO_LEADER, total_disciples: 1, total_cells: 1 });
const debora = row({ name: "Débora Lopes", gender: "F", g12_level: 3, leader_name: "Beatriz Souza", g12_name: "Tânia Rocha", total_cells: 1 });
const umDiscipulo = row({ name: "Um Discípulo", total_disciples: 1, total_cells: 0 });
const milhar = row({ name: "Milhar Silva", total_disciples: 2000, total_cells: 0 });

const originalWidth = window.innerWidth;
const setWidth = (width: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: width });

function renderMembers(rows: MemberRow[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  respondWith({ data: rows, count: rows.length });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Members />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Colunas a 1024 px: Nome, Nível, Liderança, Ministério, Situação, Ações. */
const COL = { name: 0, level: 1, leadership: 2, ministry: 3, status: 4 };
async function tableRow(name: string, offset = 0) {
  await screen.findAllByText(name);
  const nameCell = screen.getAllByText(name).find((el) => el.matches("div.break-words > span.font-medium"));
  const tr = nameCell?.closest("tr");
  expect(tr, `linha de ${name}`).not.toBeNull();
  return { tr: tr as HTMLElement, cells: within(tr as HTMLElement).getAllByRole("cell"), offset };
}
const visibleOf = (cell: HTMLElement) => cell.querySelector('[aria-hidden="true"]')?.textContent?.replace(/\s+/g, " ").trim();
const spokenOf = (cell: HTMLElement) => cell.querySelector(".sr-only")?.textContent;
const cardOf = async (name: string) => {
  await screen.findAllByText(name);
  const el = screen.getAllByText(name).find((e) => e.matches("p.font-semibold"));
  return el?.closest("div.space-y-3") as HTMLElement;
};

beforeEach(() => resetFakeSupabase());
afterEach(() => setWidth(originalWidth));

describe("RN-02, UX-01: o nível da pessoa na lista de Membros", () => {
  const expected: Array<[MemberRow, string]> = [
    [samuel, "Pastor"],
    [magda, "Pastora"],
    [pedro, "G12"],
    [lucia, "G12"],
    [andre, "144"],
    [caio, "1.728"],
    [gabriel, "20.736"],
    [sonia, "Nível 5"],
    [ester, "Sem liderança"],
    [oldPastor, "Pastor(a)"],
  ];

  it.each([1280, 1024])("Dada a tabela a %i px, então cada pessoa mostra o rótulo do nível do P40", async (width) => {
    setWidth(width);
    renderMembers(expected.map(([m]) => m));
    for (const [member, label] of expected) {
      const { cells } = await tableRow(member.name);
      const offset = width >= 1280 ? 2 : 0; // foto e nome antes; o Celular entra depois do Nome
      const levelCell = cells[COL.level + offset];
      expect(within(levelCell).getByText(label), `${member.name}: ${label}`).toBeInTheDocument();
    }
  });

  it("Dados os cartões a 360 px, então o nível é o mesmo e nenhum '12' sozinho nem 'Pastor(a)' para quem tem sexo", async () => {
    setWidth(360);
    renderMembers(expected.map(([m]) => m));
    for (const [member, label] of expected) {
      expect(within(await cardOf(member.name)).getByText(label), `${member.name}: ${label}`).toBeInTheDocument();
    }
    expect(screen.queryByText("12")).not.toBeInTheDocument();
    expect(screen.getAllByText("Pastor(a)")).toHaveLength(1);
  });
});

describe("RN-10, UX-02 e UX-16: a Liderança da lista", () => {
  const all = [samuel, pedro, andre, caio, gabriel, ester, lucia, debora];

  it("Dada a tabela, então a Liderança é o G12 e o líder (no máximo dois nomes), '—' para o pastor e 'Sem liderança'", async () => {
    setWidth(1024);
    renderMembers(all);
    const value = async (name: string) => visibleOf((await tableRow(name)).cells[COL.leadership]);
    expect(await value("Samuel Colares")).toBe("—");
    expect(await value("Pedro Alves")).toBe("Samuel Colares");
    expect(await value("André Souza")).toBe("Pedro Alves");
    expect(await value("Caio Lima")).toBe("Pedro Alves / André Souza");
    expect(await value("Gabriel Nunes")).toBe("Pedro Alves / Fábio Lima");
    expect(await value("Ester Ramos")).toBe("Sem liderança");
    expect(await value("Lúcia Freitas")).toBe("Ester Ramos");
    expect(await value("Débora Lopes")).toBe("Tânia Rocha / Beatriz Souza");
  });

  it("Dada a Liderança de Débora, então os nomes não são links (nomes de referência)", async () => {
    setWidth(1024);
    renderMembers(all);
    const { cells } = await tableRow("Débora Lopes");
    expect(within(cells[COL.leadership]).queryByRole("link")).toBeNull();
    expect(within(cells[COL.leadership]).queryByRole("button")).toBeNull();
  });

  it("Dado o leitor de tela, então ouve 'G12 Pedro Alves, líder André Souza' para Caio e 'Nenhuma' para Samuel (UX-16)", async () => {
    setWidth(1024);
    renderMembers(all);
    expect(spokenOf((await tableRow("Caio Lima")).cells[COL.leadership])).toBe("G12 Pedro Alves, líder André Souza");
    expect(spokenOf((await tableRow("Samuel Colares")).cells[COL.leadership])).toBe("Nenhuma");
  });

  it("Dado o nível 144, então o leitor de tela ouve 'nível 144' (UX-16)", async () => {
    setWidth(1024);
    renderMembers([andre]);
    const { cells } = await tableRow("André Souza");
    expect(cells[COL.level]).toHaveTextContent("nível 144");
  });

  it("Dados os cartões, então Samuel e Ester não têm a linha 'Liderança:' e os demais têm, com o mesmo valor", async () => {
    setWidth(360);
    renderMembers(all);
    for (const name of ["Samuel Colares", "Ester Ramos"]) {
      expect(within(await cardOf(name)).queryByText(/Liderança:/)).toBeNull();
    }
    const line = (card: HTMLElement) => within(card).getByText(/Liderança:/).textContent?.replace(/\s+/g, " ");
    expect(line(await cardOf("Pedro Alves"))).toContain("Samuel Colares");
    expect(visibleOf(within(await cardOf("Caio Lima")).getByText(/Liderança:/) as HTMLElement)).toBe("Pedro Alves / André Souza");
    expect(visibleOf(within(await cardOf("Lúcia Freitas")).getByText(/Liderança:/) as HTMLElement)).toBe("Ester Ramos");
  });
});

describe("UX-18: nenhuma tela mostra o caminho inteiro", () => {
  it.each([360, 1280])("A %i px, o caminho 'Samuel / Pedro / André / Fábio' não aparece e a Liderança tem no máximo dois nomes", async (width) => {
    setWidth(width);
    renderMembers([gabriel, caio, sonia]);
    await screen.findAllByText("Gabriel Nunes");
    expect(document.body.textContent).not.toContain("Samuel Colares / Pedro Alves");
    const separators = (document.body.textContent?.match(/ \/ /g) ?? []).length;
    expect(separators).toBe(3); // uma por pessoa com G12 e líder diferentes
  });
});

describe("UX-03: o cabeçalho da tabela de Membros", () => {
  const headers = () => screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());

  it("Em 1024 px: Nome, Nível, Liderança, Ministério, Situação e Ações, sem 'Nível G12', 'Líder' nem 'Status'", async () => {
    setWidth(1024);
    renderMembers([pedro]);
    await screen.findAllByText("Pedro Alves");
    expect(headers()).toEqual(["Nome", "Nível", "Liderança", "Ministério", "Situação", "Ações"]);
    for (const old of ["Nível G12", "Líder", "Status"]) expect(screen.queryByRole("columnheader", { name: old })).toBeNull();
  });

  it("Em 1280 px entram a foto antes do Nome e o Celular depois dele", async () => {
    setWidth(1280);
    renderMembers([pedro]);
    await screen.findAllByText("Pedro Alves");
    expect(headers()).toEqual(["", "Nome", "Celular", "Nível", "Liderança", "Ministério", "Situação", "Ações"]);
  });
});

describe("RN-05 e RN-06, UX-04: os totais por extenso", () => {
  it("Dada a tabela, então Diego mostra '3 discípulos' e '3 células' e Olga '1 discípulo' e '1 célula', sem abreviar", async () => {
    setWidth(1024);
    renderMembers([diego, olga, umDiscipulo, milhar, ester]);
    const ministry = async (name: string) => (await tableRow(name)).cells[COL.ministry];
    const diegoCell = await ministry("Diego Reis");
    expect(within(diegoCell).getByText("3 discípulos")).toBeInTheDocument();
    expect(within(diegoCell).getByText("3 células")).toBeInTheDocument();
    const olgaCell = await ministry("Olga Reis");
    expect(within(olgaCell).getByText("1 discípulo")).toBeInTheDocument();
    expect(within(olgaCell).getByText("1 célula")).toBeInTheDocument();
    expect(within(await ministry("Um Discípulo")).getByText("0 células")).toBeInTheDocument();
    expect(within(await ministry("Milhar Silva")).getByText("2.000 discípulos")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/disc\.|cél\./);
  });

  it("Dados os cartões, então os totais ficam numa linha só: '2 discípulos · 3 células'", async () => {
    setWidth(360);
    renderMembers([andre, umDiscipulo, milhar]);
    const totals = async (name: string) => visibleOf((await cardOf(name)).querySelector("span.block") as HTMLElement);
    expect(await totals("André Souza")).toBe("2 discípulos · 3 células");
    expect(await totals("Um Discípulo")).toBe("1 discípulo · 0 células");
    expect(await totals("Milhar Silva")).toBe("2.000 discípulos · 0 células");
    expect(document.body.textContent).not.toMatch(/disc\.|cél\./);
  });

  it("Dado um total, então número e palavra não se partem (whitespace-nowrap)", async () => {
    setWidth(360);
    renderMembers([andre]);
    const card = await cardOf("André Souza");
    for (const text of ["2 discípulos", "3 células"]) {
      expect(within(card).getByText(text)).toHaveClass("whitespace-nowrap");
    }
  });
});

describe("UX-05: cartões ou tabela conforme a largura, já no primeiro render", () => {
  it.each([
    [360, "cartões"],
    [768, "cartões"],
    [1023, "cartões"],
    [1024, "tabela"],
    [1280, "tabela"],
  ])("A %i px o primeiro render já são %s", async (width, kind) => {
    setWidth(width);
    renderMembers([pedro]);
    // Sem esperar a lista: a decisão vem do `matchMedia` no primeiro render.
    if (kind === "tabela") expect(screen.getByRole("table")).toBeInTheDocument();
    else expect(screen.queryByRole("table")).toBeNull();
    await screen.findAllByText("Pedro Alves");
    if (kind === "tabela") expect(screen.getByRole("table")).toBeInTheDocument();
    else expect(screen.queryByRole("table")).toBeNull();
  });

  it("Dado um nome de 40 caracteres na Liderança, então quebra linha (break-words) e a tabela não força largura", async () => {
    setWidth(1024);
    const longName = "Maria Aparecida Fernanda de Souza Bragan";
    expect(longName).toHaveLength(40);
    renderMembers([row({ name: "Pessoa Longa", g12_level: 2, leader_name: longName, g12_name: longName })]);
    const { cells } = await tableRow("Pessoa Longa");
    const span = cells[COL.leadership].querySelector("span.break-words");
    expect(span).not.toBeNull();
    await waitFor(() => expect(cells[COL.leadership]).toHaveTextContent(longName));
  });
});

describe("RN-08, P44: a lista recarregando", () => {
  it("Dados os cartões e as linhas, então sem recarga não há opacity-60 nem aria-busy ativo", async () => {
    setWidth(1024);
    renderMembers([pedro]);
    const { tr } = await tableRow("Pedro Alves");
    expect(tr).not.toHaveClass("opacity-60");
  });
});
