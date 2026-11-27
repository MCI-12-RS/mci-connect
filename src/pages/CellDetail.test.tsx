import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeQueries, fakeRpcs, resetFakeSupabase, respondToRpc, respondWith } from "@/test/fake-supabase";
import type { PermissionAction } from "@/lib/access/permissions";
import type { CellDetailRow } from "@/lib/cells/fields";
import type { CellRecentReport } from "@/lib/cells/detail";
import CellDetail from "./CellDetail";

// Detalhe da célula (E2.10, PR 5, tarefas 13 e 15): UX-16, UX-18, UX-19,
// UX-21, UX-23, UX-24, UX-28 e UX-30 com respostas simuladas. A massa é a do
// spec (C1 de André Souza; R1, R2, R4 e R5 visíveis para Pedro).

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});
vi.mock("@/components/AppLayout", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

let permissions: PermissionAction[] = [];
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u" },
    access: { member_id: "m", permissions, sees_whole_church: false },
    hasPermission: (...perms: PermissionAction[]) => perms.some((p) => permissions.includes(p)),
  }),
}));

const C1_ID = "11111111-1111-4111-8111-111111111111";

function cellRow(overrides: Partial<CellDetailRow> = {}): CellDetailRow {
  return {
    id: C1_ID,
    leader_id: "l-andre",
    timothy_id: "t-caio",
    host_id: "h-carla",
    type: "Evangelística",
    meeting_day: "Quarta",
    meeting_time: "20:00:00",
    street: "Rua das Flores",
    number: "100",
    complement: null,
    neighborhood: "Centro",
    city: "Porto Alegre",
    state: "RS",
    zip_code: "90010000",
    is_active: true,
    leader_name: "André Souza",
    leader_g12_level: 2,
    leader_is_pastor: false,
    leader_gender: "M",
    timothy_name: "Caio Lima",
    host_name: "Carla Dias",
    g12_leader_name: "Pedro Alves",
    can_submit_report: true,
    updated_at: "2026-11-20T13:15:00Z",
    report_status: "not_yet",
    report_missing_weeks: 0,
    created_at: "2025-03-10T22:40:00Z",
    created_by_kind: "member",
    created_by_name: "Rita Gomes",
    updated_by_kind: "member",
    updated_by_name: "Pedro Alves",
    ...overrides,
  };
}

function report(overrides: Partial<CellRecentReport> & { id: string; date: string }): CellRecentReport {
  return {
    time: "20:00:00",
    was_held: true,
    theme: null,
    reason_not_held: null,
    observations: null,
    offering: 0,
    participants_count: 0,
    visitors_count: 0,
    participants_trend: null,
    visitors_trend: null,
    ...overrides,
  };
}

const R1 = report({
  id: "r1",
  date: "2026-11-18",
  theme: "A fé que vence",
  observations: "Dois visitantes do trabalho do Caio",
  offering: 50,
  participants_count: 8,
  visitors_count: 2,
  participants_trend: 1,
  visitors_trend: 1,
});
const R2 = report({ id: "r2", date: "2026-11-11", was_held: false, reason_not_held: "Chuva forte no bairro", offering: null });
const R4 = report({
  id: "r4",
  date: "2026-10-28",
  theme: "Perdão",
  offering: 20,
  participants_count: 6,
  visitors_count: 0,
  participants_trend: 1,
  visitors_trend: -1,
});
const R5 = report({ id: "r5", date: "2026-10-21", theme: "Graça", offering: 10, participants_count: 5, visitors_count: 1 });
const C1_REPORTS = [R1, R2, R4, R5];

const originalWidth = window.innerWidth;
const setWidth = (width: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: width });

/** Um cliente com a linha da lista no cache (UXD-12) e a situação das pessoas já lida (sem outra consulta). */
function clientWithListRow(row: CellDetailRow) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["cells", "list", { page: 1 }], { rows: [row], total: 1 });
  client.setQueryData(["members", "statuses", [row.host_id, row.leader_id, row.timothy_id].sort()], new Map());
  return client;
}

function renderDetail(path: string, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/cells/:id" element={<CellDetail />} />
          <Route path="/cells" element={<h1>Lista de Células</h1>} />
          <Route path="/" element={<h1>Início</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** A célula, os relatórios e a situação das pessoas (líder, timóteo e anfitrião). */
function respondCell(cell: CellDetailRow | null, reports: CellRecentReport[] = C1_REPORTS, statuses: unknown[] = []) {
  respondWith({ data: cell }, { data: statuses });
  respondToRpc("cell_recent_reports", { data: reports });
}

/** O texto de cada nó, separado por espaço (os blocos não grudam). */
const texts = (root: Element) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) parts.push(node.textContent ?? "");
  return parts.join(" ").replace(/\s+/g, " ").replace(/ ([,.])/g, "$1").trim();
};
/** O texto que se vê (sem o que só o leitor de tela ouve). */
const seen = (el: Element | null) => {
  if (!el) return "";
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll(".sr-only").forEach((n) => n.remove());
  return texts(clone);
};
/** O texto que se vê numa linha só (os nós de texto de um mesmo trecho grudam: "André Souza (144)"). */
const seenInline = (el: Element | null) => {
  if (!el) return "";
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll(".sr-only").forEach((n) => n.remove());
  return clone.textContent?.replace(/\s+/g, " ").trim() ?? "";
};
/** O que o leitor de tela lê (sem o que é `aria-hidden`). */
const spoken = (el: Element | null) => {
  if (!el) return "";
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  return texts(clone);
};

const section = (name: string) => screen.findByRole("region", { name });

beforeEach(() => {
  resetFakeSupabase();
  permissions = ["view_own_ministry"];
  setWidth(360);
});
afterEach(() => setWidth(originalWidth));

describe("UX-16, UX-24: célula não encontrada", () => {
  it("id sem formato: a tela de não encontrada, sem nenhuma requisição", async () => {
    renderDetail("/cells/xyz");
    expect(screen.getByRole("heading", { level: 1, name: "Célula não encontrada" })).toHaveFocus();
    expect(screen.getByText("Ela não existe, foi excluída ou não está disponível para você.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Voltar para Células" })).toHaveAttribute("href", "/cells");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fakeQueries()).toHaveLength(0);
    expect(fakeRpcs()).toHaveLength(0);
  });

  it("a célula que não volta da cells_view: o mesmo DOM, sem nenhum dado da lista", async () => {
    // A linha veio da lista, mas a leitura do detalhe diz que ela não existe: a linha é descartada.
    const client = clientWithListRow(cellRow());
    respondWith({ data: null });
    respondToRpc("cell_recent_reports", { data: [] });
    renderDetail(`/cells/${C1_ID}`, client);
    expect(await screen.findByRole("heading", { level: 1, name: "Célula não encontrada" })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("André");
    expect(document.body.textContent).not.toContain(C1_ID);
  });

  it("sem a lista de Células (Lia, Hugo): Ir para o início", async () => {
    permissions = ["view_all_reports"];
    renderDetail("/cells/xyz");
    expect(screen.getByRole("link", { name: "Ir para o início" })).toHaveAttribute("href", "/");
  });
});

describe("UX-18, UX-28: o conteúdo do detalhe", () => {
  it("C1 para Rita: título, complemento, situação, pessoas, endereço e autoria", async () => {
    permissions = ["view_all_church"];
    respondCell(cellRow());
    renderDetail(`/cells/${C1_ID}`);
    const h1 = await screen.findByRole("heading", { level: 1, name: "Célula de André Souza" });
    await waitFor(() => expect(h1).toHaveFocus());
    const meeting = h1.parentElement?.querySelector("p") ?? null;
    expect(seen(meeting)).toBe("Quarta · 20:00 · Evangelística");
    expect(spoken(meeting)).toBe("Reunião: Quarta, 20:00, Evangelística");
    expect(screen.getByText("Ativa")).toBeInTheDocument();

    const status = await section("Situação do relatório");
    expect(within(status).getByText("Ainda não ocorreu")).toBeInTheDocument();
    expect(within(status).getByText(/O relatório fica pendente 1 hora depois do horário da célula\./)).toBeInTheDocument();

    const people = await section("Pessoas da célula");
    const terms = within(people).getAllByRole("term").map((t) => t.textContent);
    expect(terms).toEqual(["Líder", "Timóteo", "Anfitrião", "G12"]);
    const values = within(people).getAllByRole("definition").map((d) => seenInline(d));
    expect(values).toEqual(["André Souza (144)", "Caio Lima", "Carla Dias", "Pedro Alves"]);
    expect(within(people).queryAllByRole("link")).toHaveLength(0);

    expect(seen(await section("Endereço da célula"))).toContain("Rua das Flores, 100 Centro · Porto Alegre, RS CEP 90010-000");
    expect(screen.getByText(/Rita Gomes/)).toBeInTheDocument();

    // h1 → h2 → h3 e cada seção com aria-labelledby (UX-28).
    const h2s = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(h2s).toEqual(["Situação do relatório", "Pessoas da célula", "Endereço da célula", "Últimos relatórios", "Evolução"]);
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(3);
  });

  it("C4 para Pedro: inativa, pessoa inativa e a frase sem situação", async () => {
    respondCell(
      cellRow({
        leader_name: "Gabriel Costa",
        leader_g12_level: 4,
        timothy_name: "Jonas Prado",
        host_name: "Fábio Lima",
        is_active: false,
        can_submit_report: false,
        report_status: null,
        report_missing_weeks: null,
      }),
      [],
      [{ id: "h-carla", is_active: false, gender: "M" }],
    );
    renderDetail(`/cells/${C1_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Célula de Gabriel Costa" });
    expect(screen.getByText("Inativa")).toBeInTheDocument();
    expect(within(await section("Situação do relatório")).getByText("Célula inativa: sem situação do relatório.")).toBeInTheDocument();
    const values = within(await section("Pessoas da célula")).getAllByRole("definition");
    expect(seenInline(values[0])).toBe("Gabriel Costa (20.736)");
    await waitFor(() => expect(seenInline(values[2])).toBe("Fábio Lima (inativo)"));
    // Sem relatório visível: a frase, sem "Ver todos" e sem Evolução (RN-17, RN-20).
    expect(await screen.findByText("Nenhum relatório para mostrar.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Ver todos os relatórios/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Evolução" })).not.toBeInTheDocument();
  });

  it("pastor e sem liderança; sem endereço", async () => {
    respondCell(
      cellRow({
        leader_name: "Ester Ramos",
        leader_g12_level: null,
        leader_is_pastor: false,
        leader_gender: "F",
        g12_leader_name: null,
        street: null,
        number: null,
        neighborhood: null,
        city: null,
        state: null,
        zip_code: null,
      }),
      [],
    );
    renderDetail(`/cells/${C1_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Célula de Ester Ramos" });
    const values = within(await section("Pessoas da célula")).getAllByRole("definition");
    expect(seenInline(values[0])).toBe("Ester Ramos (Sem liderança)");
    expect(seen(values[3])).toBe("—");
    expect(spoken(values[3])).toBe("nenhum");
    expect(within(await section("Endereço da célula")).getByText("Sem endereço")).toBeInTheDocument();
  });
});

describe("UX-19: ações conforme as permissões", () => {
  it("Pedro em 360 px: Novo relatório no rodapé, Editar célula e o ⋯ no cabeçalho", async () => {
    permissions = ["view_own_ministry", "edit_cell", "delete_cell", "edit_cell_report", "delete_cell_report"];
    respondCell(cellRow());
    renderDetail(`/cells/${C1_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Célula de André Souza" });
    const footer = screen.getByTestId("cell-detail-footer");
    expect(within(footer).getByRole("button", { name: "Novo relatório" })).toBeInTheDocument();
    expect(footer.className).toContain("md:hidden");
    expect(screen.getAllByRole("button", { name: "Editar célula" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Ações da célula de André Souza" })).toBeInTheDocument();
    // O rodapé fica no fim do DOM (a ordem do foco segue a posição na tela).
    const main = screen.getByRole("main");
    expect(main.lastElementChild?.contains(footer) || main.contains(footer)).toBe(true);
  });

  it("Caio (só lança): só Novo relatório; nenhuma ação nos relatórios", async () => {
    permissions = ["view_own_ministry", "submit_own_cell_report"];
    respondCell(cellRow());
    renderDetail(`/cells/${C1_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Célula de André Souza" });
    expect(screen.queryByRole("button", { name: "Editar célula" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ações da célula/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Novo relatório" }).length).toBeGreaterThan(0);
    await screen.findByRole("heading", { level: 3, name: "Quarta, 18/11/2026 às 20:00" });
    expect(screen.queryByRole("button", { name: /Editar o relatório/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ações do relatório/ })).not.toBeInTheDocument();
  });

  it("sem nenhuma permissão e sem lançar: nenhuma ação nem rodapé", async () => {
    respondCell(cellRow({ can_submit_report: false }));
    renderDetail(`/cells/${C1_ID}`);
    await screen.findByRole("heading", { level: 1, name: "Célula de André Souza" });
    expect(screen.queryByRole("button", { name: "Novo relatório" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("cell-detail-footer")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar célula" })).not.toBeInTheDocument();
  });
});

describe("UX-21: últimos relatórios", () => {
  it("cartões em 360 px: R1, R2 e R4, com as setas e os textos do Negócio", async () => {
    permissions = ["view_own_ministry", "edit_cell_report", "delete_cell_report"];
    respondCell(cellRow());
    renderDetail(`/cells/${C1_ID}`);
    const reports = await section("Últimos relatórios");
    await within(reports).findByRole("heading", { level: 3, name: "Quarta, 18/11/2026 às 20:00" });
    const headings = within(reports).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["Quarta, 18/11/2026 às 20:00", "Quarta, 11/11/2026 às 20:00", "Quarta, 28/10/2026 às 20:00"]);
    expect(within(reports).getByText("As setas comparam com o relatório anterior de célula realizada.")).toBeInTheDocument();

    const [r1, r2, r4] = within(reports).getAllByRole("article");
    expect(seen(r1)).toContain("Tema: A fé que vence");
    expect(seen(r1)).toContain("Participantes 8 Visitantes 2 Oferta R$ 50,00");
    expect(spoken(r1)).toContain("8, mais que no relatório anterior");
    expect(spoken(r1)).toContain("2, mais que no relatório anterior");
    expect(seen(r1)).toContain("Observações: Dois visitantes do trabalho do Caio");
    expect(seen(r2)).toContain("Não houve célula");
    expect(seen(r2)).toContain("Motivo: Chuva forte no bairro");
    expect(seen(r2)).not.toContain("Participantes");
    expect(spoken(r4)).toContain("6, mais que no relatório anterior");
    expect(spoken(r4)).toContain("0, menos que no relatório anterior");
    expect(seen(r4)).toContain("R$ 20,00");
    expect(within(r1).getByRole("button", { name: "Editar o relatório de 18/11/2026 da célula de André Souza" })).toHaveClass("h-11");
    expect(within(r1).getByRole("button", { name: "Ações do relatório de 18/11/2026 da célula de André Souza" })).toBeInTheDocument();

    const all = within(reports).getByRole("link", { name: "Ver todos os relatórios da célula de André Souza" });
    expect(all).toHaveAttribute("href", `/cell-reports?cell=${C1_ID}`);
  });

  it("tabela a partir de 1024 px: números à direita e — no Não houve célula", async () => {
    setWidth(1280);
    permissions = ["view_own_ministry", "edit_cell_report", "delete_cell_report"];
    respondCell(cellRow());
    renderDetail(`/cells/${C1_ID}`);
    const reports = await section("Últimos relatórios");
    const table = await within(reports).findByRole("table", { name: "Últimos relatórios" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    const cells = within(rows[1]).getAllByRole("cell");
    expect(spoken(cells[2])).toBe("não se aplica");
    expect(cells[2]).toHaveClass("text-right");
    expect(within(rows[0]).getByRole("button", { name: "Excluir o relatório de 18/11/2026 da célula de André Souza" })).toBeInTheDocument();
  });

  it("oferta sem valor: Não informada", async () => {
    respondCell(cellRow(), [report({ id: "x", date: "2026-11-18", offering: null, participants_count: 3 })]);
    renderDetail(`/cells/${C1_ID}`);
    expect(await screen.findByText("Não informada")).toBeInTheDocument();
    // Sem anterior: só o número, sem a frase das setas.
    expect(screen.queryByText("As setas comparam com o relatório anterior de célula realizada.")).not.toBeInTheDocument();
  });

  it("nenhum nome de participante ou de visitante na resposta usada (RN-18)", async () => {
    respondCell(cellRow());
    renderDetail(`/cells/${C1_ID}`);
    await screen.findByRole("heading", { level: 3, name: "Quarta, 18/11/2026 às 20:00" });
    const call = fakeRpcs().find((rpc) => rpc.fn === "cell_recent_reports");
    expect(call?.args).toEqual({ _cell_id: C1_ID, _limit: 10 });
  });
});

describe("UX-23: evolução", () => {
  it("a tabela em ordem cronológica, com Não houve célula, e a figure com o resumo", async () => {
    respondCell(cellRow());
    renderDetail(`/cells/${C1_ID}`);
    const evolution = await screen.findByRole("region", { name: "Evolução" });
    const figure = within(evolution).getByRole("img");
    expect(figure).toHaveAttribute(
      "aria-label",
      "Gráfico de linhas com participantes e visitantes de 4 relatórios, de 21/10/2026 a 18/11/2026. Os números estão na aba Tabela.",
    );
    expect(within(evolution).getByText("Não houve célula")).toBeInTheDocument();
    const tableTab = within(evolution).getByRole("tab", { name: "Tabela" });
    fireEvent.mouseDown(tableTab);
    fireEvent.click(tableTab);
    const table = await within(evolution).findByRole("table");
    const rows = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => seen(row));
    expect(rows).toEqual(["21/10/2026 5 1", "28/10/2026 6 0", "11/11/2026 Não houve célula", "18/11/2026 8 2"]);
  });
});

describe("UX-24, UX-30: carregando e erro", () => {
  it("vindo da lista, o topo aparece antes da leitura, com Skeleton na autoria", async () => {
    let release: () => void = () => undefined;
    const until = new Promise<void>((resolve) => {
      release = resolve;
    });
    const client = clientWithListRow(cellRow());
    respondWith({ data: cellRow(), until });
    respondToRpc("cell_recent_reports", { data: C1_REPORTS, until });
    renderDetail(`/cells/${C1_ID}`, client);
    expect(screen.getByRole("heading", { level: 1, name: "Célula de André Souza" })).toBeInTheDocument();
    expect(screen.getByTestId("authorship-loading")).toBeInTheDocument();
    expect(screen.getByTestId("cell-reports-loading")).toBeInTheDocument();
    release();
    expect(await screen.findByText(/Rita Gomes/)).toBeInTheDocument();
  });

  it("aberto por link: Célula e Skeleton, sem ações até a leitura chegar", () => {
    permissions = ["view_own_ministry", "edit_cell"];
    respondWith({ data: cellRow(), until: new Promise(() => undefined) });
    respondToRpc("cell_recent_reports", { data: [], until: new Promise(() => undefined) });
    renderDetail(`/cells/${C1_ID}`);
    expect(screen.getByRole("heading", { level: 1, name: "Célula" })).toBeInTheDocument();
    expect(screen.getByTestId("cell-detail-loading")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar célula" })).not.toBeInTheDocument();
  });

  it("falha da leitura: o Alert do Negócio, sem texto técnico, e Tentar de novo", async () => {
    respondWith({ error: { code: "57014", message: "canceling statement due to statement timeout" } });
    respondToRpc("cell_recent_reports", { data: [] });
    renderDetail(`/cells/${C1_ID}`);
    expect(await screen.findByText("Não foi possível carregar a célula. Verifique a conexão e tente de novo.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/statement|57014|cell_id|_cell/);
    respondCell(cellRow(), []);
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Célula de André Souza" })).toBeInTheDocument();
  });

  it("falha só nos relatórios: o Alert da seção, e o resto funciona", async () => {
    respondWith({ data: cellRow() }, { data: [] });
    respondToRpc("cell_recent_reports", { error: { code: "08006", message: "network" } });
    renderDetail(`/cells/${C1_ID}`);
    const reports = await section("Últimos relatórios");
    expect(
      await within(reports).findByText("Não foi possível carregar os relatórios desta célula. Verifique a conexão e tente de novo."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Evolução" })).not.toBeInTheDocument();
    expect(await section("Pessoas da célula")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("network");
  });
});
