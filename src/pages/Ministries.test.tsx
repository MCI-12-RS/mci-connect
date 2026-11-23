import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createQueryWrapper } from "@/test/query-wrapper";
import { fakeQueries, fakeRpcs, resetFakeSupabase, respondToRpc } from "@/test/fake-supabase";
import type { MinistryTreeNode } from "@/hooks/use-ministry-tree";
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

function node(overrides: Partial<MinistryTreeNode>): MinistryTreeNode {
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
    direct_disciples: 2,
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
  return render(<Ministries />, { wrapper: createQueryWrapper() });
}

/** Deixa as respostas (e as novas tentativas, com os atrasos do padrão) acontecerem. */
async function settle() {
  await act(() => vi.advanceTimersByTimeAsync(60_000));
}

const nodeButton = (name: RegExp) => screen.getByRole("button", { name });
const HINT = /Toque ou clique num nome para ver os discípulos/;
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
    await settle();

    expect(rpcCalls()).toEqual([["ministry_tree_nodes", undefined]]);
    expect(fakeQueries()).toHaveLength(0);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(nodeButton(/Paulo Pastor/)).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText(HINT)).toBeInTheDocument();
  });

  it("Dado um casal, então mostra os dois nomes, a contagem de discípulos diretos e o nível", async () => {
    respondToRpc("ministry_tree_nodes", { data: roots });

    renderMinistries();
    await settle();

    const couple = nodeButton(/Paulo Pastor/);
    expect(within(couple).getByText("Priscila Pastora")).toBeInTheDocument();
    expect(within(couple).getByText("2 discípulos diretos")).toBeInTheDocument();
    expect(within(couple).getByText("Pastor(a)")).toBeInTheDocument();
    expect(couple).toHaveAccessibleName(/Paulo Pastor e Priscila Pastora/);
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
    // O nível só com número é lido como "nível 12"; "Pastor(a)" se explica sozinho.
    expect(nodeButton(/André Alves/)).toHaveAccessibleName(/nível 12$/);
    expect(nodeButton(/Paulo Pastor/)).toHaveAccessibleName(/diretos Pastor\(a\)$/);
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

  it("Dado nenhum pastor visível, então explica que a árvore começa pelos pastores e aponta Membros, sem a dica de expandir", async () => {
    respondToRpc("ministry_tree_nodes", { data: [] });

    renderMinistries();
    await settle();

    expect(screen.getByText("Nenhum pastor visível para você.")).toBeInTheDocument();
    expect(
      screen.getByText("Por enquanto, a árvore começa pelos pastores. As pessoas do seu ministério aparecem em Membros."),
    ).toBeInTheDocument();
    expect(screen.queryByText(HINT)).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
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
});
