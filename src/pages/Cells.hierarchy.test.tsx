import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { resetFakeSupabase, respondToRpc } from "@/test/fake-supabase";
import type { CellRow } from "@/lib/cells/fields";
import Cells from "./Cells";

// Hierarquia na lista de Células (E2.06, PR 2, T8): RN-11, UX-05, UX-08, UX-16 e UX-18.

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});
vi.mock("@/components/AppLayout", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u-rita" }, access: null, hasPermission: () => true }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

function cell(id: string, overrides: Partial<CellRow>): CellRow {
  return {
    id,
    leader_id: `l-${id}`,
    timothy_id: null,
    host_id: null,
    type: "Evangelística",
    meeting_day: "Quarta",
    meeting_time: "20:00:00",
    street: "Rua das Flores",
    number: "120",
    complement: null,
    neighborhood: "Centro",
    city: null,
    state: null,
    zip_code: null,
    is_active: true,
    leader_name: "Sem Nome",
    leader_g12_level: 2,
    leader_is_pastor: false,
    leader_gender: "M",
    timothy_name: null,
    host_name: null,
    g12_leader_name: null,
    can_submit_report: true,
    ...overrides,
  };
}

const c1 = cell("c1", { leader_name: "André Souza", leader_g12_level: 2, g12_leader_name: "Pedro Alves" });
const cSamuel = cell("cs", { leader_name: "Samuel Colares", leader_g12_level: 0, leader_is_pastor: true, g12_leader_name: null });
const cMagda = cell("cm", { leader_name: "Magda Colares", leader_gender: "F", leader_g12_level: 0, leader_is_pastor: true, g12_leader_name: null });
const cEster = cell("ce", { leader_name: "Ester Ramos", leader_gender: "F", leader_g12_level: null, g12_leader_name: null });
const c9 = cell("c9", { leader_name: "Lúcia Freitas", leader_gender: "F", leader_g12_level: 1, g12_leader_name: "Lúcia Freitas" });
const c7 = cell("c7", { leader_name: "Sônia Castro", leader_gender: "F", leader_g12_level: 5, g12_leader_name: "Tiago Rocha" });
const all = [c1, cSamuel, cMagda, cEster, c9, c7];

const originalWidth = window.innerWidth;
const setWidth = (width: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: width });

function renderCells(rows: CellRow[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  respondToRpc("cells_list", { data: rows });
  respondToRpc("cells_list_count", { data: rows.length });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Cells />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const leaderEl = async (name: string) => {
  await screen.findAllByText(name, { exact: false });
  return screen.getAllByText((_, el) => el?.matches("span.break-words") === true && (el.firstChild?.textContent ?? "") === name)[0];
};
/** O texto que se vê (sem o que só o leitor de tela ouve). */
const seen = (el: Element) => {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll(".sr-only").forEach((n) => n.remove());
  return clone.textContent?.replace(/\s+/g, " ").trim();
};

beforeEach(() => resetFakeSupabase());
afterEach(() => setWidth(originalWidth));

describe("RN-11, UX-08: o líder com o nível e o G12 de um nome só", () => {
  const expected: Array<[CellRow, string, string]> = [
    [c1, "André Souza (144)", "Pedro Alves"],
    [cSamuel, "Samuel Colares (Pastor)", "Pastores"],
    [cMagda, "Magda Colares (Pastora)", "Pastores"],
    [cEster, "Ester Ramos (Sem liderança)", "—"],
    [c9, "Lúcia Freitas (G12)", "Lúcia Freitas"],
    [c7, "Sônia Castro (Nível 5)", "Tiago Rocha"],
  ];

  it("Dada a tabela a 1280 px, então cada célula mostra 'Líder (nível)' e o G12 numa coluna", async () => {
    setWidth(1280);
    renderCells(all);
    await screen.findAllByText("André Souza", { exact: false });
    for (const [c, leader, g12] of expected) {
      const tr = (await leaderEl(c.leader_name ?? "")).closest("tr") as HTMLElement;
      const cells = within(tr).getAllByRole("cell");
      expect(seen(cells[0].querySelector("span.break-words") as Element), leader).toBe(leader);
      expect(seen(cells[1]), `G12 de ${c.leader_name}`).toBe(g12);
    }
  });

  it("Dados os cartões a 360 px, então é o mesmo: 'G12: …' sob o líder com o nível", async () => {
    setWidth(360);
    renderCells(all);
    // E2.09 (UXD-4): o G12 abre o bloco das pessoas, logo abaixo do líder.
    for (const [c, leader, g12] of expected) {
      const card = (await leaderEl(c.leader_name ?? "")).closest("li") as HTMLElement;
      expect(seen(card.querySelector("span.break-words") as Element), leader).toBe(leader);
      expect(seen(card.querySelector('[data-part="people"] > p') as Element), `G12 de ${c.leader_name}`).toBe(`G12: ${g12}`);
    }
  });

  it("Dado o G12, então é sempre um nome só: nada de casal nem de 'e' entre dois nomes", async () => {
    setWidth(1280);
    renderCells(all);
    await screen.findAllByText("André Souza", { exact: false });
    expect(document.body.textContent).not.toMatch(/Pedro Alves e /);
    for (const tr of screen.getAllByRole("row").slice(1)) expect(within(tr).getAllByRole("cell")[1].textContent).not.toContain("/");
  });
});

describe("UX-16: o que o leitor de tela ouve na lista de Células", () => {
  it("Dado o nível 144 do líder, então ouve ', nível 144' depois do nome", async () => {
    setWidth(1280);
    renderCells([c1]);
    const leader = await leaderEl("André Souza");
    expect(leader.querySelector(".sr-only")).toHaveTextContent(", nível 144");
    expect(leader.querySelector('[aria-hidden="true"]')).toHaveTextContent("(144)");
  });

  it("Dada a célula de Ester, então ouve 'G12: nenhum' e o '—' fica fora do leitor", async () => {
    setWidth(360);
    renderCells([cEster]);
    const card = (await leaderEl("Ester Ramos")).closest("li") as HTMLElement;
    const p = card.querySelector('[data-part="people"] > p') as HTMLElement;
    expect(p.querySelector(".sr-only")).toHaveTextContent("nenhum");
    expect(p.querySelector('[aria-hidden="true"]')).toHaveTextContent("—");
    expect(p.textContent).toContain("G12:");
  });
});

// E2.09 (P74, UX-06): em Células, os cartões vão até 1279 px e a tabela entra em 1280 px.
describe("UX-05: cartões ou tabela conforme a largura, já no primeiro render", () => {
  it.each([
    [360, "cartões"],
    [768, "cartões"],
    [1024, "cartões"],
    [1279, "cartões"],
    [1280, "tabela"],
    [1440, "tabela"],
  ])("A %i px o primeiro render já são %s", async (width, kind) => {
    setWidth(width);
    renderCells([c1]);
    if (kind === "tabela") expect(screen.getByRole("table")).toBeInTheDocument();
    else expect(screen.queryByRole("table")).toBeNull();
    await screen.findAllByText("André Souza", { exact: false });
  });

  it("A tabela de Células tem Líder, G12, Endereço, Reunião, Relatório e Situação (sem 'Status', 'Tipo' nem 'Dia / Hora'; E2.09, UX-02)", async () => {
    setWidth(1280);
    renderCells([c1]);
    await screen.findAllByText("André Souza", { exact: false });
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(headers.slice(0, 6)).toEqual(["Líder", "G12", "Endereço", "Reunião", "Relatório", "Situação"]);
    expect(headers).not.toContain("Status");
    expect(headers).not.toContain("Tipo");
    expect(headers).not.toContain("Dia / Hora");
  });
});

describe("UX-18: o G12 da célula não mostra caminho", () => {
  it("Dada uma célula de nível 5, então só o G12 aparece, nunca a cadeia", async () => {
    setWidth(1280);
    renderCells([c7]);
    await screen.findAllByText("Sônia Castro", { exact: false });
    expect(document.body.textContent).not.toContain("Samuel Colares / Pedro Alves");
    const g12Cell = within(screen.getAllByRole("row")[1]).getAllByRole("cell")[1];
    expect(g12Cell).toHaveTextContent("Tiago Rocha");
    expect(g12Cell.textContent).not.toContain("/");
  });
});
