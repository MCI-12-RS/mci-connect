import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { createQueryWrapper } from "@/test/query-wrapper";
import { resetFakeSupabase, respondToRpc } from "@/test/fake-supabase";
import type { MinistryTreeNodeRow } from "@/hooks/use-ministry-tree";
import { MINISTRIES_TEXTS } from "@/lib/hierarchy/texts";
import Ministries from "./Ministries";

// Árvore de Ministérios (E2.06, PR 2, T11): UX-11, UX-12 e a referência do cônjuge (RN-09, P43)
// quando o casal não está no caminho aberto. A massa é a do spec (Diego e Olga, 144).

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});
vi.mock("@/components/AppLayout", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ access: null }) }));

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
const hugoVania = node({ member_id: "hugo", member_name: "Hugo Nunes", spouse_id: "vania", spouse_name: "Vânia Nunes", g12_level: 2, direct_disciples: 1, total_disciples: 1, total_cells: 0 });

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
const settle = () => act(() => vi.advanceTimersByTimeAsync(60_000));

beforeEach(() => {
  vi.useFakeTimers();
  resetFakeSupabase();
});
afterEach(() => vi.useRealTimers());

describe("UX-12: o nome acessível do nó", () => {
  it("Dado Diego e Olga, então o nome é 'Diego Reis e Olga Reis, 144, 2 discípulos, 3 células' e muda o aria-expanded ao abrir", async () => {
    respondToRpc("ministry_tree_nodes", { data: [diegoOlga] }, { data: [node({ member_id: "t", member_name: "Tadeu", g12_level: 3 })] });
    renderMinistries();
    await settle();
    const button = screen.getByRole("button", { name: "Diego Reis e Olga Reis, 144, 2 discípulos, 3 células" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    await settle();
    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  it("Dado o nó, então o coração e o '·' ficam fora do leitor de tela e o badge é um span dentro do botão", async () => {
    respondToRpc("ministry_tree_nodes", { data: [diegoOlga] });
    renderMinistries();
    await settle();
    const button = screen.getByRole("button", { name: /^Diego Reis e Olga Reis/ });
    expect(within(button).getByText("144").tagName).toBe("SPAN");
    // Tudo o que é só enfeite está em aria-hidden: o rótulo do botão não os traz.
    expect(button.getAttribute("aria-label")).not.toMatch(/[·♥❤]/);
    expect(button.querySelectorAll("div")).toHaveLength(0);
    for (const decorative of Array.from(button.querySelectorAll("svg"))) {
      expect(decorative.closest('[aria-hidden="true"]') ?? decorative.getAttribute("aria-hidden")).toBeTruthy();
    }
    const dot = within(button).queryByText("·");
    if (dot) expect(dot.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe("UX-11: o texto de ajuda da árvore", () => {
  it("Dada a árvore com nós, então o texto de ajuda é o da tabela de Textos e ninguém fala em 'discípulos diretos' fora dele", async () => {
    respondToRpc("ministry_tree_nodes", { data: [diegoOlga, hugoVania] });
    renderMinistries();
    await settle();
    expect(screen.getByText(MINISTRIES_TEXTS.help)).toBeInTheDocument();
    const rest = (document.body.textContent ?? "").replace(MINISTRIES_TEXTS.help, "");
    expect(rest).not.toMatch(/discípulos? diretos?/);
  });

  it("Dado o estado vazio (ninguém na árvore), então o texto de ajuda some", async () => {
    respondToRpc("ministry_tree_nodes", { data: [] });
    renderMinistries();
    await settle();
    expect(screen.queryByText(MINISTRIES_TEXTS.help)).toBeNull();
  });
});

describe("RN-09, P43: aninhamento direto e referência sem o casal no caminho", () => {
  it("Dado Hugo e Vânia aberto, então só Zélia aparece e Vânia não reaparece como referência", async () => {
    const zelia = node({ member_id: "zelia", member_name: "Zélia Lopes", g12_level: 4, level_gender: "F" });
    respondToRpc("ministry_tree_nodes", { data: [hugoVania] }, { data: [zelia] });
    renderMinistries();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /^Hugo Nunes e Vânia Nunes/ }));
    await settle();
    expect(screen.getByText("Zélia Lopes")).toBeInTheDocument();
    expect(screen.queryByText(/Aparece com o cônjuge/)).toBeNull();
    expect(screen.getAllByText(/Vânia Nunes/)).toHaveLength(1);
  });

  it("Dada uma referência cujo casal não está no caminho aberto, então ela aparece sem 'Ir para o casal' (degrada sem quebrar)", async () => {
    const lauro = node({ member_id: "lauro", member_name: "Lauro Mendes", g12_level: 3, direct_disciples: 1, total_disciples: 1 });
    const orfa = node({
      kind: "spouse_above",
      member_id: "olga",
      member_name: "Olga Reis",
      spouse_id: "outro-casal",
      spouse_name: "Fulano de Tal",
      g12_level: 4,
      level_gender: "F",
      total_disciples: null,
      total_cells: null,
    });
    respondToRpc("ministry_tree_nodes", { data: [lauro] }, { data: [orfa] });
    renderMinistries();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /^Lauro Mendes/ }));
    await settle();
    const row = within(screen.getByText("Aparece com o cônjuge, Fulano de Tal, mais acima.").closest("li") as HTMLElement);
    expect(row.getByText("Olga Reis")).toBeInTheDocument();
    expect(row.queryByRole("button")).toBeNull();
    expect(screen.queryByText("Ir para o casal")).toBeNull();
  });
});
