import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { createQueryWrapper } from "@/test/query-wrapper";
import { fakeQueries, fakeRpcs, resetFakeSupabase, respondToRpc } from "@/test/fake-supabase";
import type { MinistryTreeNodeRow } from "@/hooks/use-ministry-tree";
import { NO_ACCESS, type Access } from "@/lib/access/access";
import Ministries from "./Ministries";

// Árvore de ministérios sem N+1 (E1.08, RN-10): abrir a tela é uma chamada à
// RPC (as raízes) e abrir um nó é outra (os filhos do casal), já com as
// contagens. Nenhuma leitura de tabela.

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

// O menu lateral e a sessão não fazem parte do que se testa aqui.
vi.mock("@/components/AppLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

// O acesso de quem está logado: o botão do estado vazio (T10) só aparece para quem abre Membros.
const auth = vi.hoisted(() => ({ access: null as Access | null }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ access: auth.access }),
}));

const MINISTRY_ACCESS: Access = {
  ...NO_ACCESS,
  member_id: "m-1",
  role_id: "r-1",
  role_name: "Membro",
  permissions: ["view_own_ministry"],
  sees_ministry: true,
  sees_ministry_reports: true,
};

function node(overrides: Partial<MinistryTreeNodeRow>): MinistryTreeNodeRow {
  return {
    member_id: "x",
    member_name: "Sem Nome",
    member_gender: "M",
    g12_level: 1,
    is_pastor: false,
    spouse_id: null,
    spouse_name: null,
    direct_disciples: 0,
    total_disciples: 0,
    total_cells: 0,
    kind: "node",
    level_member_id: "x",
    level_gender: "M",
    level_is_pastor: false,
    spouse_is_pastor: false,
    ...overrides,
  };
}

const roots = [
  node({
    member_id: "p1",
    member_name: "Paulo Pastor",
    spouse_id: "p2",
    spouse_name: "Priscila Pastora",
    g12_level: 0,
    is_pastor: true,
    level_is_pastor: true,
    spouse_is_pastor: true,
    direct_disciples: 2,
    total_disciples: 18,
    total_cells: 8,
  }),
  node({ member_id: "s1", member_name: "Silas Pastor", g12_level: 0, is_pastor: true, direct_disciples: 1 }),
  node({ member_id: "v1", member_name: "Vitor Pastor", g12_level: 0, is_pastor: true, direct_disciples: 0 }),
];

const paulosChildren = [
  node({ member_id: "a1", member_name: "André Alves", spouse_id: "a2", spouse_name: "Ana Alves", direct_disciples: 12 }),
  node({ member_id: "b1", member_name: "Bruno Borges", direct_disciples: 0 }),
];

const silasChildren = [node({ member_id: "c1", member_name: "Carlos Cunha", direct_disciples: 0 })];

const failure = { error: { code: "08006", message: "connection failure" } };
/** A chamada e as 3 novas tentativas do padrão falham. */
const failures = [failure, failure, failure, failure];

function renderMinistries() {
  const QueryWrapper = createQueryWrapper();
  return render(<Ministries />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <MemoryRouter>
        <QueryWrapper>{children}</QueryWrapper>
      </MemoryRouter>
    ),
  });
}

/** Deixa as respostas (e as novas tentativas, com os atrasos do padrão) acontecerem. */
async function settle() {
  await act(() => vi.advanceTimersByTimeAsync(60_000));
}

const nodeButton = (name: RegExp) => screen.getByRole("button", { name });
/** O item da árvore (`li`) que tem o texto. */
function treeItem(text: string): HTMLLIElement {
  const item = screen.getByText(text).closest("li");
  if (!item) throw new Error(`sem item para ${text}`);
  return item;
}
const HINT =
  "Toque ou clique num nome para ver os discípulos diretos. Os totais somam todos os níveis abaixo de cada nome, inclusive os discípulos de pessoas inativas, que não aparecem aqui.";
const rpcCalls = () => fakeRpcs().map((call) => [call.fn, call.args]);

describe("Ministérios (RN-10)", () => {
  beforeEach(() => {
    resetFakeSupabase();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("Dada a tela aberta, então as raízes vêm de uma chamada só, sem argumentos e sem ler tabelas", async () => {
    respondToRpc("ministry_tree_nodes", { data: roots });

    renderMinistries();
    expect(screen.getByRole("status")).toHaveTextContent("Carregando…");
    // A altura do nó de duas linhas no celular, para a lista não pular.
    const placeholders = document.querySelectorAll('[aria-busy="true"] > div');
    expect(placeholders).toHaveLength(4);
    placeholders.forEach((placeholder) => expect(placeholder).toHaveClass("h-16", "sm:h-11"));
    await settle();

    expect(rpcCalls()).toEqual([["ministry_tree_nodes", undefined]]);
    expect(fakeQueries()).toHaveLength(0);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(nodeButton(/Paulo Pastor/)).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText(HINT)).toBeInTheDocument();
  });

  it("Dado um casal de pastores, então mostra os dois nomes, 'Pastores' e os totais por extenso (T3, UX-04, UX-12)", async () => {
    respondToRpc("ministry_tree_nodes", { data: roots });

    renderMinistries();
    await settle();

    const couple = nodeButton(/Paulo Pastor/);
    expect(within(couple).getByText("Priscila Pastora")).toBeInTheDocument();
    expect(within(couple).getByText("Pastores")).toBeInTheDocument();
    // O badge dentro do botão é um span (HTML válido).
    expect(within(couple).getByText("Pastores").tagName).toBe("SPAN");
    expect(within(couple).getByText("18 discípulos")).toHaveClass("whitespace-nowrap");
    expect(within(couple).getByText("8 células")).toHaveClass("whitespace-nowrap");
    expect(couple).toHaveAccessibleName("Paulo Pastor e Priscila Pastora, Pastores, 18 discípulos, 8 células");
    // Um pastor só no nó: "Pastor", nunca "Pastores" nem "Pastor(a)".
    expect(nodeButton(/Silas Pastor/)).toHaveAccessibleName("Silas Pastor, Pastor, 0 discípulos, 0 células");
  });

  it("Dada a árvore, então os totais aparecem sempre, inclusive com zero, e nada fala em discípulos diretos nem abrevia (UX-04, UX-11)", async () => {
    respondToRpc("ministry_tree_nodes", { data: roots });

    renderMinistries();
    await settle();

    // Vitor é folha e tem zero nos dois totais.
    const vitor = within(treeItem("Vitor Pastor"));
    expect(vitor.getByText("0 discípulos")).toBeInTheDocument();
    expect(vitor.getByText("0 células")).toBeInTheDocument();
    // Só a ajuda fala em discípulos diretos (o que aparece ao abrir); os totais, nunca.
    const text = (document.body.textContent ?? "").replace(HINT, "");
    expect(text).not.toMatch(/discípulos? diretos?/);
    expect(text).not.toMatch(/disc\.|cél\./);
  });

  it("Dada uma raiz sem liderança (nível nulo), então mostra 'Sem liderança', e não 'Nível null' (P40)", async () => {
    respondToRpc("ministry_tree_nodes", {
      data: [node({ member_id: "e1", member_name: "Ester Ramos", g12_level: null, level_gender: "F", direct_disciples: 1, total_disciples: 1 })],
    });

    renderMinistries();
    await settle();

    expect(nodeButton(/Ester Ramos/)).toHaveAccessibleName("Ester Ramos, Sem liderança, 1 discípulo, 0 células");
    expect(screen.getByText("Sem liderança")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/null/);
  });

  it("Dado um nó sem discípulos diretos (folha), então ele aparece sem botão de expandir", async () => {
    respondToRpc("ministry_tree_nodes", { data: roots });

    renderMinistries();
    await settle();

    expect(screen.getByText("Vitor Pastor")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Vitor Pastor/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("Dado um casal expandido, então os filhos vêm de uma chamada só, com os ids dos dois", async () => {
    respondToRpc("ministry_tree_nodes", { data: roots }, { data: paulosChildren });
    renderMinistries();
    await settle();

    fireEvent.click(nodeButton(/Paulo Pastor/));
    await settle();

    expect(rpcCalls()).toEqual([
      ["ministry_tree_nodes", undefined],
      ["ministry_tree_nodes", { _parent_ids: ["p1", "p2"] }],
    ]);
    expect(nodeButton(/Paulo Pastor/)).toHaveAttribute("aria-expanded", "true");
    expect(nodeButton(/André Alves/)).toBeInTheDocument();
    // O nível da posição: "G12", nunca "12" sozinho.
    expect(nodeButton(/André Alves/)).toHaveAccessibleName("André Alves e Ana Alves, G12, 0 discípulos, 0 células");
    // Bruno é folha: aparece sem botão.
    expect(screen.getByText("Bruno Borges")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Bruno Borges/ })).not.toBeInTheDocument();
    expect(fakeQueries()).toHaveLength(0);
  });

  it("Dado um nó sem cônjuge, quando é expandido, então a chamada leva só o id dele, sem nulos", async () => {
    respondToRpc("ministry_tree_nodes", { data: roots }, { data: silasChildren });
    renderMinistries();
    await settle();

    fireEvent.click(nodeButton(/Silas Pastor/));
    await settle();

    expect(rpcCalls()[1]).toEqual(["ministry_tree_nodes", { _parent_ids: ["s1"] }]);
    expect(screen.getByText("Carlos Cunha")).toBeInTheDocument();
  });

  it("Dado um nó expandido, quando é recolhido e reaberto, então não chama a RPC de novo", async () => {
    respondToRpc("ministry_tree_nodes", { data: roots }, { data: paulosChildren });
    renderMinistries();
    await settle();
    fireEvent.click(nodeButton(/Paulo Pastor/));
    await settle();

    fireEvent.click(nodeButton(/Paulo Pastor/));
    await settle();
    expect(screen.queryByText("André Alves")).not.toBeInTheDocument();
    expect(nodeButton(/Paulo Pastor/)).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(nodeButton(/Paulo Pastor/));
    await settle();

    expect(nodeButton(/André Alves/)).toBeInTheDocument();
    expect(fakeRpcs()).toHaveLength(2);
  });

  it("Dados dois níveis abertos, então cada expansão é uma chamada (N+1 não acontece)", async () => {
    respondToRpc(
      "ministry_tree_nodes",
      { data: roots },
      { data: paulosChildren },
      { data: [node({ member_id: "d1", member_name: "Davi Dias" })] },
    );
    renderMinistries();
    await settle();

    fireEvent.click(nodeButton(/Paulo Pastor/));
    await settle();
    fireEvent.click(nodeButton(/André Alves/));
    await settle();

    expect(rpcCalls()).toEqual([
      ["ministry_tree_nodes", undefined],
      ["ministry_tree_nodes", { _parent_ids: ["p1", "p2"] }],
      ["ministry_tree_nodes", { _parent_ids: ["a1", "a2"] }],
    ]);
    expect(screen.getByText("Davi Dias")).toBeInTheDocument();
    expect(fakeQueries()).toHaveLength(0);
  });

  it("Dado ninguém visível na árvore para quem não abre Membros, então o estado vazio pede um administrador, sem a dica de expandir (E2.02, T10, AQ-10)", async () => {
    auth.access = null;
    respondToRpc("ministry_tree_nodes", { data: [] });

    renderMinistries();
    await settle();

    expect(screen.getByText("Ninguém visível para você na árvore.")).toHaveClass("text-foreground");
    expect(screen.getByText("Fale com um administrador.")).toBeInTheDocument();
    // Não aponta para uma tela que a pessoa não vê.
    expect(screen.queryByText("As pessoas do seu ministério aparecem em Membros.")).not.toBeInTheDocument();
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
    // Sem acesso a Membros, nenhum caminho que levaria a uma tela sem acesso.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("Dado o estado vazio para quem abre Membros, então aponta Membros e o botão 'Ver membros do seu ministério' leva a /members (T10)", async () => {
    auth.access = MINISTRY_ACCESS;
    respondToRpc("ministry_tree_nodes", { data: [] });

    renderMinistries();
    await settle();

    expect(screen.getByText("Ninguém visível para você na árvore.")).toHaveClass("text-foreground");
    expect(screen.getByText("As pessoas do seu ministério aparecem em Membros.")).toBeInTheDocument();
    expect(screen.queryByText("Fale com um administrador.")).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Ver membros do seu ministério" });
    expect(link).toHaveAttribute("href", "/members");
    expect(link).toHaveClass("h-11");
  });

  it("Dada uma falha nas raízes, então mostra o erro e Tentar novamente refaz a chamada", async () => {
    respondToRpc("ministry_tree_nodes", ...failures, { data: roots });
    renderMinistries();
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível carregar a árvore.");
    expect(screen.queryByText("Paulo Pastor")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    // O botão some enquanto carrega: o foco vai para o título, e não para o body.
    const heading = screen.getByRole("heading", { name: "Ministérios" });
    expect(heading).toHaveFocus();
    await settle();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(nodeButton(/Paulo Pastor/)).toBeInTheDocument();
    expect(heading).toHaveFocus();
    expect(fakeRpcs().every((call) => call.args === undefined)).toBe(true);
  });

  it("Dada uma falha ao abrir um nó, então o erro aparece dentro dele e Tentar novamente refaz só essa chamada", async () => {
    respondToRpc("ministry_tree_nodes", { data: roots }, ...failures, { data: paulosChildren });
    renderMinistries();
    await settle();

    fireEvent.click(nodeButton(/Paulo Pastor/));
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível carregar os discípulos.");
    // As outras raízes continuam na tela.
    expect(nodeButton(/Silas Pastor/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    // O botão some enquanto carrega: o foco volta para o nó, e não para o body.
    expect(nodeButton(/Paulo Pastor/)).toHaveFocus();
    await settle();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(nodeButton(/André Alves/)).toBeInTheDocument();
    expect(nodeButton(/Paulo Pastor/)).toHaveFocus();
    const childCalls = fakeRpcs().filter((call) => call.args !== undefined);
    expect(childCalls.every((call) => JSON.stringify(call.args) === JSON.stringify({ _parent_ids: ["p1", "p2"] }))).toBe(
      true,
    );
    expect(fakeQueries()).toHaveLength(0);
  });

  it("Dado um erro de permissão nas raízes (42501), então mostra o erro sem novas tentativas", async () => {
    respondToRpc("ministry_tree_nodes", { error: { code: "42501", message: "sem permissão" } });

    renderMinistries();
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível carregar a árvore.");
    expect(fakeRpcs()).toHaveLength(1);
  });
  describe("cônjuge que está abaixo do outro (T4, RN-09, P43)", () => {
    const diegoOlga = node({
      member_id: "diego",
      member_name: "Diego Reis",
      spouse_id: "olga",
      spouse_name: "Olga Reis",
      g12_level: 2,
      direct_disciples: 2,
      total_disciples: 2,
      total_cells: 3,
    });
    const diegosChildren = [
      node({ member_id: "lauro", member_name: "Lauro Mendes", g12_level: 3, direct_disciples: 2, total_disciples: 2, total_cells: 2 }),
      node({ member_id: "sonia", member_name: "Sônia Castro", g12_level: 5, level_gender: "F", total_cells: 1 }),
    ];
    const laurosChildren = [
      node({
        kind: "spouse_above",
        member_id: "olga",
        member_name: "Olga Reis",
        spouse_id: "diego",
        spouse_name: "Diego Reis",
        g12_level: 4,
        level_gender: "F",
        direct_disciples: 0,
        total_disciples: null,
        total_cells: null,
      }),
    ];
    const goToCouple = () => screen.getByRole("button", { name: "Ir para Diego Reis e Olga Reis, mais acima na árvore" });

    async function openUpToLauro() {
      respondToRpc("ministry_tree_nodes", { data: [diegoOlga] }, { data: diegosChildren }, { data: laurosChildren });
      renderMinistries();
      await settle();
      fireEvent.click(nodeButton(/^Diego Reis e Olga Reis/));
      await settle();
      fireEvent.click(nodeButton(/^Lauro Mendes/));
      await settle();
    }

    it("Dado Lauro aberto, então Olga aparece como referência: sem seta, sem totais, com o nível dela, a frase e 'Ir para o casal' (UX-10)", async () => {
      await openUpToLauro();

      const row = within(treeItem("Aparece com o cônjuge, Diego Reis, mais acima."));
      expect(row.getByText("Olga Reis")).toBeInTheDocument();
      expect(row.getByText("20.736")).toBeInTheDocument();
      expect(row.queryByText(/discípulo|célula/)).not.toBeInTheDocument();
      // O único botão é o "Ir para o casal": a referência não abre.
      expect(row.getAllByRole("button")).toEqual([goToCouple()]);
      expect(goToCouple()).toHaveTextContent("Ir para o casal");
      expect(goToCouple()).toHaveClass("h-11", "md:h-9");
      // Nenhum nó "Diego Reis e Olga Reis" sob Lauro: o casal aparece uma vez só.
      expect(screen.getAllByRole("button", { name: /^Diego Reis e Olga Reis,/ })).toHaveLength(1);
      expect(screen.getAllByText("Olga Reis")).toHaveLength(2);
    });

    it("Dado 'Ir para o casal', então rola até o nó do casal, foca e destaca por 2 s, sem abrir nem fechar nó nem chamar a RPC (UX-10)", async () => {
      await openUpToLauro();
      const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
      const calls = fakeRpcs().length;
      const couple = nodeButton(/^Diego Reis e Olga Reis/);

      fireEvent.click(goToCouple());

      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll.mock.contexts[0]).toBe(couple);
      expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
      expect(couple).toHaveFocus();
      expect(couple).toHaveClass("ring-2", "ring-ring");
      expect(couple).toHaveAttribute("aria-expanded", "true");
      expect(nodeButton(/^Lauro Mendes/)).toHaveAttribute("aria-expanded", "true");
      expect(goToCouple()).toBeInTheDocument();

      await act(() => vi.advanceTimersByTimeAsync(1_999));
      expect(couple).toHaveClass("ring-2");
      await act(() => vi.advanceTimersByTimeAsync(1));
      expect(couple).not.toHaveClass("ring-2");
      expect(fakeRpcs()).toHaveLength(calls);
      scroll.mockRestore();
    });

    it("Dado prefers-reduced-motion, então a rolagem do 'Ir para o casal' é imediata", async () => {
      await openUpToLauro();
      const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
      const matchMedia = vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => true,
      }));

      fireEvent.click(goToCouple());

      expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
      matchMedia.mockRestore();
      scroll.mockRestore();
    });
  });
});
