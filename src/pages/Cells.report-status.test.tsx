import type { ReactNode } from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { resetFakeSupabase, respondToRpc, type FakeResponse } from "@/test/fake-supabase";
import type { CellListRow } from "@/lib/cells/fields";
import Cells from "./Cells";

// Situação do relatório na lista de Células (E2.09, PR 3, tarefa 11): UX-02,
// UX-04, UX-05, UX-06, UX-08, UX-09 e UX-14, com a massa da RN-04 (Rita, quinta,
// 26/11, 10:00). O servidor manda o código; a tela só traduz.

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});
vi.mock("@/components/AppLayout", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u-rita" }, access: null, hasPermission: () => true }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

function cell(id: string, leader: string, overrides: Partial<CellListRow>): CellListRow {
  return {
    id,
    leader_id: `l-${id}`,
    timothy_id: null,
    host_id: null,
    type: "Evangelística",
    meeting_day: "Quarta",
    meeting_time: "20:00:00",
    street: "Rua das Flores",
    number: "100",
    complement: null,
    neighborhood: "Centro",
    city: null,
    state: null,
    zip_code: null,
    is_active: true,
    leader_name: leader,
    leader_g12_level: 2,
    leader_is_pastor: false,
    leader_gender: "M",
    timothy_name: "Caio Lima",
    host_name: "Carla Dias",
    g12_leader_name: "Pedro Alves",
    can_submit_report: true,
    report_status: "pending",
    report_missing_weeks: 0,
    ...overrides,
  };
}

const C1 = cell("c1", "André Souza", {});
const C9 = cell("c9", "Pedro Alves", { leader_g12_level: 1, type: "Macrocélula", meeting_time: "19:30:00", report_missing_weeks: 2 });
const C5 = cell("c5", "Samuel Colares", {
  leader_g12_level: 0,
  leader_is_pastor: true,
  type: "Discipulado",
  meeting_day: "Segunda",
  meeting_time: "19:30:00",
  report_status: "sent_not_held",
});
const C6 = cell("c6", "Paula Alves", {
  leader_gender: "F",
  leader_g12_level: 1,
  type: "Discipulado",
  meeting_day: "Quinta",
  report_status: "not_yet",
  report_missing_weeks: 3,
});
const C10 = cell("c10", "Bruno Souza", { report_status: "next_week" });
const C3 = cell("c3", "Davi Souza", { report_status: "sent_held" });
const C7 = cell("c7", "Tiago Souza", { is_active: false, meeting_day: "Terça", report_status: null, report_missing_weeks: null });
const ALL = [C1, C9, C5, C6, C10, C3, C7];

const originalWidth = window.innerWidth;
const setWidth = (width: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: width });

/** A página da lista (`cells_list`) e, em seguida, o total (`cells_list_count`), lidos em paralelo (E2.10). */
function renderCells(page: FakeResponse, ...more: FakeResponse[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const total = Array.isArray(page.data) ? page.data.length : 0;
  respondToRpc("cells_list", { ...page, count: undefined }, ...more);
  respondToRpc("cells_list_count", { data: total, until: page.until, error: page.error });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Cells />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** O texto que se vê (sem o que só o leitor de tela ouve). */
const seen = (el: Element | null) => {
  if (!el) return null;
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll(".sr-only").forEach((n) => n.replaceWith(" "));
  return clone.textContent?.replace(/\s+/g, " ").trim() ?? null;
};
/** O que o leitor de tela lê (sem o que é `aria-hidden`). */
const spoken = (el: Element | null) => {
  if (!el) return null;
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  return clone.textContent?.replace(/\s+/g, " ").trim() ?? null;
};

/** O nome do líder no topo do cartão ou na 1ª coluna da linha (o G12 pode ter o mesmo nome). */
const leaderEl = async (leader: string) => {
  await screen.findAllByText(leader, { exact: false });
  return screen.getAllByText((_, el) => el?.matches("span.break-words") === true && (el.firstChild?.textContent ?? "") === leader)[0];
};
const cardOf = async (leader: string) => (await leaderEl(leader)).closest("li") as HTMLElement;
/** A linha "Relatório:" do cartão: o último bloco do lado da reunião. */
const reportLine = (card: HTMLElement) => card.querySelector('[data-part="meeting"] > div:last-child');
const rowOf = async (leader: string) => (await leaderEl(leader)).closest("tr") as HTMLElement;
/** O texto de cada filho, um por linha do bloco. */
const lines = (el: Element) => [...el.children].map((child) => seen(child));
const reportCell = (row: HTMLElement) => within(row).getAllByRole("cell")[4];

beforeEach(() => resetFakeSupabase());
afterEach(() => setWidth(originalWidth));

describe("UX-01, P71: a linha 'Relatório' nos cartões (360 px)", () => {
  it.each([
    [C1, "Relatório: Pendente"],
    [C9, "Relatório: Pendente Sem relatório nas 2 semanas anteriores"],
    [C5, "Relatório: Enviado · Não houve célula"],
    [C6, "Relatório: Ainda não ocorreu Sem relatório nas 3 semanas anteriores"],
    [C10, "Relatório: Conta a partir da próxima semana"],
    [C3, "Relatório: Enviado · Célula realizada"],
  ])("%#: %s", async (c, text) => {
    setWidth(360);
    renderCells({ data: ALL, count: ALL.length });
    const card = await cardOf(c.leader_name ?? "");
    expect(seen(reportLine(card))).toBe(text);
  });

  it("RN-01: a célula inativa tem 'Inativa' e não tem a linha 'Relatório'", async () => {
    setWidth(360);
    renderCells({ data: ALL, count: ALL.length });
    const card = await cardOf("Tiago Souza");
    expect(card).toHaveTextContent("Inativa");
    expect(card.textContent).not.toContain("Relatório");
  });

  it("UXD-4: o endereço fica com as pessoas, e a reunião e o relatório fecham o cartão", async () => {
    setWidth(360);
    renderCells({ data: [C1], count: 1 });
    const card = await cardOf("André Souza");
    const people = card.querySelector('[data-part="people"]') as HTMLElement;
    expect(lines(people)).toEqual(["G12: Pedro Alves", "Timóteo: Caio Lima", "Anfitrião: Carla Dias", "Rua das Flores, 100 — Centro"]);
    const meeting = card.querySelector('[data-part="meeting"]') as HTMLElement;
    expect(lines(meeting)).toEqual(["EvangelísticaAtiva", "Quarta · 20:00", "Relatório: Pendente"]);
  });
});

describe("UX-14: o que o leitor de tela ouve", () => {
  it("C9: 'Relatório: Pendente, Sem relatório nas 2 semanas anteriores'; C5: 'Enviado, Não houve célula'; a reunião: 'Quarta, 19:30'", async () => {
    setWidth(360);
    renderCells({ data: ALL, count: ALL.length });
    const c9 = await cardOf("Pedro Alves");
    expect(spoken(reportLine(c9))).toBe("Relatório: Pendente, Sem relatório nas 2 semanas anteriores");
    expect(spoken(c9.querySelector('[data-part="meeting"] > p'))).toBe("Quarta, 19:30");
    const c5 = await cardOf("Samuel Colares");
    expect(spoken(reportLine(c5))).toBe("Relatório: Enviado, Não houve célula");
  });

  it("os ícones são aria-hidden, e os badges não recebem foco, não têm title nem abrem nada", async () => {
    setWidth(360);
    renderCells({ data: ALL, count: ALL.length });
    const card = await cardOf("Pedro Alves");
    const line = reportLine(card) as HTMLElement;
    for (const svg of line.querySelectorAll("svg")) expect(svg).toHaveAttribute("aria-hidden", "true");
    for (const el of line.querySelectorAll("*")) {
      expect(el.hasAttribute("tabindex")).toBe(false);
      expect(el.hasAttribute("title")).toBe(false);
    }
    expect(within(line).queryByRole("button")).toBeNull();
    expect(within(line).queryByRole("link")).toBeNull();
  });
});

describe("UX-05, P70: o badge do relatório", () => {
  it("usa o StatusBadge com o tom do código, rounded-md e quebra por dentro, sem texto branco", async () => {
    setWidth(360);
    renderCells({ data: ALL, count: ALL.length });
    const expected: Array<[CellListRow, string, string]> = [
      [C1, "bg-warning/15", "lucide-triangle-alert"],
      [C5, "bg-success/15", "lucide-circle-check"],
      [C6, "bg-muted", "lucide-clock"],
      [C10, "bg-muted", "lucide-calendar-clock"],
    ];
    for (const [c, tone, icon] of expected) {
      const badge = reportLine(await cardOf(c.leader_name ?? ""))?.querySelector("span.rounded-md") as HTMLElement;
      expect(badge, c.leader_name ?? "").toHaveClass(tone, "rounded-md", "whitespace-normal", "text-left", "items-start", "text-foreground");
      expect(badge).not.toHaveClass("rounded-full");
      expect(badge.className).not.toMatch(/text-white|bg-success(?!\/)|bg-warning(?!\/)/);
      expect(badge.querySelector("svg")).toHaveClass(icon);
    }
  });

  it("a linha das semanas tem o CalendarX2 e o texto em text-foreground, e não é badge", async () => {
    setWidth(360);
    renderCells({ data: [C9], count: 1 });
    const weeks = (await screen.findByText("Sem relatório nas 2 semanas anteriores")).parentElement as HTMLElement;
    expect(weeks).toHaveClass("text-foreground", "font-medium");
    expect(weeks).not.toHaveClass("rounded-md");
    expect(weeks.querySelector("svg")).toHaveClass("lucide-calendar-x2");
  });
});

describe("UX-02, T2: a tabela (1280 px)", () => {
  it("mostra a situação na coluna Relatório e '—' na inativa, lido como 'Não se aplica, célula inativa'", async () => {
    setWidth(1280);
    renderCells({ data: ALL, count: ALL.length });
    expect(seen(reportCell(await rowOf("André Souza")))).toBe("Pendente");
    expect(seen(reportCell(await rowOf("Pedro Alves")))).toBe("Pendente Sem relatório nas 2 semanas anteriores");
    expect(seen(reportCell(await rowOf("Samuel Colares")))).toBe("Enviado · Não houve célula");
    expect(seen(reportCell(await rowOf("Paula Alves")))).toBe("Ainda não ocorreu Sem relatório nas 3 semanas anteriores");
    const c7 = reportCell(await rowOf("Tiago Souza"));
    expect(seen(c7)).toBe("—");
    expect(spoken(c7)).toBe("Não se aplica, célula inativa");
  });

  it("a coluna Reunião tem 'Quarta · 20:00' e o badge do tipo embaixo; os títulos são th scope=col", async () => {
    setWidth(1280);
    renderCells({ data: [C1], count: 1 });
    const meeting = within(await rowOf("André Souza")).getAllByRole("cell")[3].firstElementChild as HTMLElement;
    expect(lines(meeting)).toEqual(["Quarta · 20:00", "Evangelística"]);
    expect(spoken(meeting.firstElementChild)).toBe("Quarta, 20:00");
    for (const th of screen.getAllByRole("columnheader")) expect(th).toHaveAttribute("scope", "col");
    expect(screen.getByRole("columnheader", { name: "Relatório" })).toHaveClass("min-w-40");
  });
});

describe("UX-06, P74: a forma em cada largura, já no primeiro render", () => {
  it.each([
    [360, "cartões"],
    [768, "cartões"],
    [1024, "cartões"],
    [1279, "cartões"],
    [1280, "tabela"],
    [1440, "tabela"],
  ])("%i px: %s", (width, kind) => {
    setWidth(width);
    renderCells({ data: [C1], count: 1, until: new Promise(() => undefined) });
    // Antes de qualquer dado chegar, a forma já é a certa.
    if (kind === "tabela") expect(screen.getByRole("table")).toBeInTheDocument();
    else expect(screen.queryByRole("table")).toBeNull();
  });

  it("de 1024 a 1279 px, o corpo do cartão tem duas colunas, com a mesma ordem do DOM do celular", async () => {
    setWidth(1024);
    renderCells({ data: [C1], count: 1 });
    const card = await cardOf("André Souza");
    const body = card.querySelector('[data-part="people"]')?.parentElement as HTMLElement;
    expect(body).toHaveClass("lg:grid", "lg:grid-cols-2", "lg:gap-x-8");
    expect([...body.children].map((el) => el.getAttribute("data-part"))).toEqual(["people", "meeting"]);
  });
});

describe("UX-08: sem dia da reunião e código desconhecido", () => {
  const noDay = cell("cx", "Lia Souza", { meeting_day: null, report_status: "no_meeting_day", report_missing_weeks: null });
  const unknown = cell("cy", "Rui Souza", { report_status: null, report_missing_weeks: 2 });

  it("cartão: 'Relatório: Sem dia da reunião', sem badge nem semanas; o desconhecido mostra '—', lido como 'Situação indisponível'", async () => {
    setWidth(360);
    const rows: unknown[] = [noDay, unknown, { ...C1, id: "cz", leader_name: "Ivo Souza", report_status: "recess" }];
    renderCells({ data: rows, count: rows.length });
    const lia = reportLine(await cardOf("Lia Souza")) as HTMLElement;
    expect(seen(lia)).toBe("Relatório: Sem dia da reunião");
    expect(lia.querySelector("span.rounded-md")).toBeNull();
    expect(seen((await cardOf("Lia Souza")).querySelector('[data-part="meeting"] > p'))).toBe("— · 20:00");
    for (const leader of ["Rui Souza", "Ivo Souza"]) {
      const line = reportLine(await cardOf(leader));
      expect(seen(line), leader).toBe("Relatório: —");
      expect(spoken(line), leader).toBe("Relatório: Situação indisponível");
    }
  });

  it("tabela: 'Sem dia da reunião' em texto e '—' com 'Situação indisponível'", async () => {
    setWidth(1280);
    renderCells({ data: [noDay, unknown], count: 2 });
    const lia = reportCell(await rowOf("Lia Souza"));
    expect(seen(lia)).toBe("Sem dia da reunião");
    expect(lia.querySelector("span.rounded-md")).toBeNull();
    const rui = reportCell(await rowOf("Rui Souza"));
    expect(seen(rui)).toBe("—");
    expect(spoken(rui)).toBe("Situação indisponível");
  });
});

describe("UX-09, P73: a legenda", () => {
  const LEGEND = "Entenda a situação do relatório";

  it("começa fechada, com aria-expanded=false e 44 px no celular; aberta, mostra os cinco badges, as semanas e o rodapé numa dl", async () => {
    setWidth(360);
    renderCells({ data: [C1], count: 1 });
    const button = await screen.findByRole("button", { name: LEGEND });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveClass("min-h-11", "md:min-h-9");
    expect(screen.queryByText("A reunião desta semana já passou e o relatório não foi enviado.")).toBeNull();

    fireEvent.click(button);

    expect(button).toHaveAttribute("aria-expanded", "true");
    const content = document.getElementById(button.getAttribute("aria-controls") ?? "") as HTMLElement;
    const dl = content.querySelector("dl") as HTMLElement;
    expect([...dl.querySelectorAll("dt")].map((dt) => seen(dt))).toEqual([
      "Enviado · Célula realizada",
      "Enviado · Não houve célula",
      "Ainda não ocorreu",
      "Pendente",
      "Conta a partir da próxima semana",
      "Sem relatório nas semanas anteriores",
    ]);
    expect([...dl.querySelectorAll("dd")].map((dd) => dd.textContent)).toEqual([
      "O relatório desta semana foi enviado, e a célula se reuniu.",
      "O relatório desta semana foi enviado com \"Não houve célula\".",
      "A reunião desta semana ainda não aconteceu. O relatório fica pendente 1 hora depois do horário da célula.",
      "A reunião desta semana já passou e o relatório não foi enviado.",
      "A célula foi cadastrada ou reativada depois da reunião desta semana. O relatório só fica pendente a partir da próxima semana.",
      "Quantas semanas seguidas, antes desta, ficaram sem relatório. Vai até \"4 ou mais\".",
    ]);
    expect(content).toHaveTextContent("A semana vai de domingo a sábado. A situação é a do momento em que a lista foi carregada.");
    expect(content).toHaveClass("max-w-3xl", "bg-muted/50", "text-foreground");
  });

  it("fica à vista enquanto a lista carrega e sem resultado", async () => {
    setWidth(360);
    renderCells({ data: [], count: 0, until: new Promise(() => undefined) });
    expect(screen.getByRole("button", { name: LEGEND })).toBeInTheDocument();
    resetFakeSupabase();
  });

  it("fica à vista na lista vazia", async () => {
    setWidth(1280);
    renderCells({ data: [], count: 0 }, { data: null, count: 0 });
    await screen.findByText("Nenhuma célula encontrada.");
    expect(screen.getByRole("button", { name: LEGEND })).toBeInTheDocument();
  });

  it("some no erro ao carregar", async () => {
    setWidth(360);
    renderCells({ error: { code: "XX000", message: "boom" } });
    await screen.findByText("Não foi possível carregar as células. Verifique a conexão e tente de novo.");
    expect(screen.queryByRole("button", { name: LEGEND })).toBeNull();
  });
});

describe("UX-04: a lista não tem os termos proibidos", () => {
  it.each([360, 1280])("a %i px", async (width) => {
    setWidth(width);
    renderCells({ data: ALL, count: ALL.length });
    await screen.findByText("André Souza", { exact: false });
    fireEvent.click(screen.getByRole("button", { name: "Entenda a situação do relatório" }));
    expect(document.body.textContent).not.toMatch(/Status|Atrasado|Entregue|Cancelada|Células sem Relatório|Sem relatório a |cobr/);
  });
});
