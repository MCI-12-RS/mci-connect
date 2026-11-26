import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeQueries, fakeRpcs, resetFakeSupabase, respondToRpc, respondWith, type FakeQuery } from "@/test/fake-supabase";
import Events from "./Events";

// Auditoria nova (E2.05, T7 a T10; RN-15, RN-17 a RN-20): paginação e filtros no servidor, estado
// na URL, cards no celular, histórico de um registro e painel legível.

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

vi.mock("@/components/AppLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const IGOR = "aaaaaaaa-0000-4000-8000-000000000001";

const event = (overrides: object = {}) => ({
  id: "e1",
  occurred_at: "2026-11-24T00:50:00Z", // 23/11/2026 21:50 em Brasília
  seq: 1,
  actor_kind: "member",
  actor_label: "Bruno Lima",
  action: "update",
  entity: "member",
  entity_id: IGOR,
  entity_label: "Igor Nunes",
  description: "Alterou o membro Igor Nunes",
  changed_fields: ["leader_id", "mobile_whatsapp"],
  changes: {
    fields: [
      { field: "leader_id", from: "Bruno Lima", to: "Pedro Alves", from_id: "bbbbbbbb-0000-4000-8000-000000000002", to_id: "cccccccc-0000-4000-8000-000000000003" },
      { field: "mobile_whatsapp" },
    ],
  },
  metadata: {},
  success: true,
  error_reason: null,
  ...overrides,
});

const igorChange = event();
const reportChange = event({
  id: "e2",
  entity: "cell_report",
  entity_id: "dddddddd-0000-4000-8000-000000000004",
  entity_label: "Relatório de 25/11/2026 da célula de Carla Dias",
  description: "Alterou o relatório de 25/11/2026 da célula de Carla Dias",
  changes: { fields: [{ field: "offering", from: 50, to: 80 }, { field: "observations" }] },
});
const roleChange = event({
  id: "e3",
  entity: "role",
  entity_id: "eeeeeeee-0000-4000-8000-000000000005",
  entity_label: "Secretaria",
  actor_label: "Ana Souza",
  description: "Alterou a função Secretaria",
  changes: {
    fields: [{ field: "name", from: "Secretária", to: "Secretaria" }],
    permissions: { added: ["view_sensitive_data"], removed: ["edit_member"] },
  },
});
const systemChange = event({ id: "e4", actor_kind: "system", actor_label: null, description: "Alterou a célula de Bruno Lima", entity: "cell" });
const loginFailure = event({
  id: "e5",
  action: "login_failed",
  entity: "auth",
  actor_kind: "none",
  actor_label: null,
  entity_label: "Ana Souza",
  description: "Falha no login",
  changes: null,
  metadata: { reason: "wrong_password" },
  success: false,
});

const originalWidth = window.innerWidth;
const setWidth = (width: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: width });

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.search}</p>;
}

function renderPage(url = "/events") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route
            path="/events"
            element={
              <>
                <Events />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** As consultas de página (com `range`), sem as de contagem. */
const pageQueries = (): FakeQuery[] => fakeQueries().filter((query) => query.methods().includes("range"));
const lastPageQuery = () => pageQueries()[pageQueries().length - 1];
const UUID_LIKE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

beforeEach(() => {
  resetFakeSupabase();
  setWidth(1280);
});
afterEach(() => setWidth(originalWidth));

describe("UX-11 e RN-18: paginação no servidor, com o total", () => {
  it("lê a events_view com range e contagem exata, do mais recente para o mais antigo, sem limite fixo", async () => {
    respondWith({ data: [igorChange], count: 12000 });
    renderPage();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("12.000 eventos"));
    const query = lastPageQuery();
    expect(query.table).toBe("events_view");
    expect(query.calls).toContainEqual(["range", 0, 24]);
    expect(query.calls).toContainEqual(["order", "occurred_at", { ascending: false }]);
    expect(query.calls).toContainEqual(["order", "seq", { ascending: false }]);
    expect(query.methods()).not.toContain("limit");
    expect(screen.getByText("Página 1 de 480")).toBeInTheDocument();
  });

  it("'1 evento' no singular", async () => {
    respondWith({ data: [igorChange], count: 1 });
    renderPage();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/^1 evento$/));
  });
});

describe("UX-12 e AQ-9: o estado na URL", () => {
  it("os filtros e a busca da URL vão para o servidor (o período pela data de Brasília)", async () => {
    respondWith({ data: [], count: 0 });
    renderPage("/events?q=igor&action=update&entity=cell&status=error&from=2026-11-01&to=2026-11-15&page=2&size=50");
    await screen.findByText("Nenhum evento encontrado para estes filtros.");
    const calls = pageQueries()[0].calls;
    expect(calls).toContainEqual(["ilike", "search_text", "%igor%"]);
    expect(calls).toContainEqual(["eq", "action", "update"]);
    expect(calls).toContainEqual(["eq", "entity", "cell"]);
    expect(calls).toContainEqual(["eq", "success", false]);
    expect(calls).toContainEqual(["gte", "occurred_on", "2026-11-01"]);
    expect(calls).toContainEqual(["lte", "occurred_on", "2026-11-15"]);
    expect(calls).toContainEqual(["range", 50, 99]);
  });

  it("um valor inválido sai da URL", async () => {
    respondWith({ data: [], count: 0 }, { data: [], count: 0 });
    renderPage("/events?action=atualizar&status=ok&q=ana");
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\?q=ana$/));
  });

  it("mudar um filtro volta para a página 1 e grava na URL", async () => {
    respondWith({ data: [igorChange], count: 100 }, { data: [igorChange], count: 3 });
    renderPage("/events?page=3");
    await screen.findByText("Alterou o membro Igor Nunes");
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Status" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "Erro" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\?status=error$/));
    expect(lastPageQuery().calls).toContainEqual(["range", 0, 24]);
  });
});

describe("UX-14 e P33: o período", () => {
  it("'De' e 'Até' nativos num fieldset 'Período', com max = hoje; 'Até' antes de 'De' dá o erro e não consulta", async () => {
    respondWith({ data: [igorChange], count: 1 }, { data: [igorChange], count: 1 });
    renderPage();
    await screen.findByText("Alterou o membro Igor Nunes");
    const period = screen.getByRole("group", { name: "Período" });
    const from = within(period).getByLabelText("De");
    const to = within(period).getByLabelText("Até");
    expect(from).toHaveAttribute("type", "date");
    expect(to).toHaveAttribute("max", expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));

    fireEvent.change(from, { target: { value: "2026-11-15" } });
    await waitFor(() => expect(lastPageQuery().calls).toContainEqual(["gte", "occurred_on", "2026-11-15"]));
    const before = pageQueries().length;
    fireEvent.change(to, { target: { value: "2026-11-10" } });
    expect(await screen.findByText("O fim do período precisa ser igual ou posterior ao início.")).toBeInTheDocument();
    expect(to).toHaveAttribute("aria-invalid", "true");
    expect(pageQueries()).toHaveLength(before);
  });
});

describe("UX-15 e T8: filtros no celular", () => {
  it("o botão 'Filtros', o painel que aplica só em 'Aplicar filtros', os chips e 'Limpar filtros'", async () => {
    setWidth(360);
    respondWith({ data: [igorChange], count: 1 }, { data: [igorChange], count: 1 }, { data: [igorChange], count: 1 });
    renderPage();
    await screen.findByText("Alterou o membro Igor Nunes");
    expect(screen.queryByRole("combobox", { name: "Ação" })).not.toBeInTheDocument();
    const filtersButton = screen.getByRole("button", { name: "Filtros" });
    expect(filtersButton.className).toContain("h-11");

    fireEvent.click(filtersButton);
    const sheet = await screen.findByRole("dialog", { name: "Filtros" });
    fireEvent.keyDown(within(sheet).getByRole("combobox", { name: "Ação" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "Alteração" }));
    expect(pageQueries()).toHaveLength(1);
    fireEvent.click(within(screen.getByRole("dialog", { name: "Filtros" })).getByRole("button", { name: "Aplicar filtros" }));

    await waitFor(() => expect(lastPageQuery().calls).toContainEqual(["eq", "action", "update"]));
    expect(screen.getByRole("button", { name: "Filtros (1)" })).toBeInTheDocument();
    const chip = screen.getByRole("button", { name: "Remover filtro Ação: Alteração" });
    expect(screen.getByRole("button", { name: "Limpar filtros" })).toBeInTheDocument();
    fireEvent.click(chip);
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^$/));
    expect(screen.queryByRole("button", { name: /Remover filtro/ })).not.toBeInTheDocument();
  });

  it("fechar o painel sem aplicar descarta a escolha", async () => {
    setWidth(360);
    respondWith({ data: [igorChange], count: 1 });
    renderPage();
    await screen.findByText("Alterou o membro Igor Nunes");
    fireEvent.click(screen.getByRole("button", { name: "Filtros" }));
    const sheet = await screen.findByRole("dialog", { name: "Filtros" });
    fireEvent.keyDown(within(sheet).getByRole("combobox", { name: "Status" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "Erro" }));
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Filtros" }), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Filtros" })).not.toBeInTheDocument());
    expect(pageQueries()).toHaveLength(1);
    expect(screen.getByTestId("where")).toHaveTextContent(/^$/);
  });
});

describe("UX-16 e P34: cards no celular", () => {
  it("uma lista de botões, com a descrição primeiro, a segunda linha, o autor e a data, a ação e o 'Erro' só no que falhou; fechar devolve o foco", async () => {
    setWidth(360);
    respondWith({ data: [igorChange, loginFailure], count: 2 });
    renderPage();
    const list = await screen.findByTestId("audit-event-cards");
    const [igorCard, failureCard] = within(list).getAllByRole("button");
    expect(igorCard).toHaveTextContent(/^Alterou o membro Igor NunesLíder, Celular\/WhatsAppBruno Lima · 23\/11\/2026 às 21:50AlteraçãoMembro$/);
    expect(within(igorCard).queryByText("Erro")).not.toBeInTheDocument();
    expect(failureCard).toHaveTextContent("Senha incorreta · Ana Souza");
    expect(failureCard).toHaveTextContent("23/11/2026 às 21:50");
    expect(failureCard).not.toHaveTextContent("—");
    expect(within(failureCard).getByText("Erro")).toBeInTheDocument();

    igorCard.focus();
    fireEvent.click(igorCard);
    const sheet = await screen.findByRole("dialog", { name: "Detalhes do evento" });
    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => expect(igorCard).toHaveFocus());
  });
});

describe("UX-17: tabela no computador", () => {
  it("as 6 colunas e a descrição como botão que abre o painel", async () => {
    respondWith({ data: [igorChange], count: 1 });
    renderPage();
    const table = await screen.findByTestId("audit-event-table");
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Data/Hora",
      "Autor",
      "Ação",
      "Entidade",
      "Descrição",
      "Status",
    ]);
    const open = within(table).getByRole("button", { name: "Alterou o membro Igor Nunes" });
    expect(within(table).getByText("23/11/2026 21:50")).toBeInTheDocument();
    fireEvent.click(open);
    expect(await screen.findByRole("dialog", { name: "Detalhes do evento" })).toBeInTheDocument();
  });
});

describe("UX-19, UX-30 e P32: o painel legível", () => {
  it("'Líder: Bruno Lima → Pedro Alves' (lido 'de … para …'), 'Celular/WhatsApp' sem valor, sem nome técnico, JSON, UUID ou data aaaa-mm-dd", async () => {
    respondWith({ data: [igorChange], count: 1 });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Alterou o membro Igor Nunes" }));
    const sheet = within(await screen.findByRole("dialog", { name: "Detalhes do evento" }));
    expect(sheet.getByText("23/11/2026 às 21:50")).toBeInTheDocument();
    expect(sheet.getByText("Registro")).toBeInTheDocument();
    const leader = sheet.getByText(/^Líder:/).closest("li");
    expect(leader).toHaveTextContent("Líder: Bruno Lima → Pedro Alves");
    expect(within(leader).getByText("Bruno Lima → Pedro Alves")).toHaveAttribute("aria-hidden", "true");
    expect(within(leader).getByText("de Bruno Lima para Pedro Alves")).toHaveClass("sr-only");
    expect(sheet.getByText("Celular/WhatsApp").tagName).toBe("LI");
    const text = document.body.textContent ?? "";
    for (const technical of ["leader_id", "mobile_whatsapp", "{", "Metadados", "Atualização"]) expect(text).not.toContain(technical);
    expect(text).not.toMatch(UUID_LIKE);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("a oferta como 'Oferta: R$ 50,00 → R$ 80,00' e o histórico do relatório", async () => {
    respondWith({ data: [reportChange], count: 1 });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Alterou o relatório de 25/11/2026 da célula de Carla Dias" }));
    const sheet = within(await screen.findByRole("dialog", { name: "Detalhes do evento" }));
    expect(sheet.getByText(/^Oferta:/).closest("li")).toHaveTextContent(/Oferta: R\$.50,00 → R\$.80,00/);
    expect(sheet.getByRole("link", { name: "Ver histórico deste relatório" })).toHaveAttribute(
      "href",
      "/events?record_type=cell_report&record_id=dddddddd-0000-4000-8000-000000000004",
    );
  });
});

describe("UX-20 e RN-15: funções", () => {
  it("'Nome: … → …', 'Permissões incluídas' e 'Permissões retiradas' pelos rótulos, sem identificador e sem 'Ver histórico'", async () => {
    respondWith({ data: [roleChange], count: 1 });
    renderPage();
    expect(await screen.findByText("Nome · 1 permissão incluída · 1 permissão retirada")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Alterou a função Secretaria" }));
    const dialog = await screen.findByRole("dialog", { name: "Detalhes do evento" });
    const sheet = within(dialog);
    expect(sheet.getByText(/^Nome:/).closest("li")).toHaveTextContent("Nome: Secretária → Secretaria");
    expect(sheet.getByText("Permissões incluídas").nextElementSibling).toHaveTextContent("Ver Dados Sensíveis");
    expect(sheet.getByText("Permissões retiradas").nextElementSibling).toHaveTextContent("Editar Membro");
    expect(dialog).not.toHaveTextContent("view_sensitive_data");
    expect(sheet.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("UX-21: o autor", () => {
  it("'Sistema' na gravação sem pessoa e '—' no login sem sessão", async () => {
    respondWith({ data: [systemChange, loginFailure], count: 2 });
    renderPage();
    const rows = within(await screen.findByTestId("audit-event-table")).getAllByRole("row").slice(1);
    expect(within(rows[0]).getAllByRole("cell")[1]).toHaveTextContent(/^Sistema$/);
    expect(within(rows[1]).getAllByRole("cell")[1]).toHaveTextContent(/^—$/);
  });
});

describe("UX-22 a UX-25 e RN-19: histórico de um registro", () => {
  const historyUrl = `/events?record_type=member&record_id=${IGOR}`;

  it("o título, 'Ver toda a Auditoria', a nota de guarda, só os eventos do registro e só Ação e Período", async () => {
    respondToRpc("audit_record_label", { data: [{ name: "Igor Nunes", leader_name: null, report_date: null, deleted: false }] });
    respondWith({ data: [igorChange], count: 1 });
    renderPage(historyUrl);
    expect(await screen.findByRole("heading", { level: 1, name: "Histórico de Igor Nunes" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver toda a Auditoria" })).toHaveAttribute("href", "/events");
    expect(screen.getByText("Cadastro, alterações, exclusões e restaurações deste membro.")).toBeInTheDocument();
    expect(screen.getByTestId("retention-note")).toHaveTextContent(
      "Os eventos ficam guardados por 2 anos. Login e logout, por 1 ano. Falhas, recusas e bloqueios, por 90 dias.",
    );
    await screen.findByText("Alterou o membro Igor Nunes");
    const calls = pageQueries()[0].calls;
    expect(calls).toContainEqual(["eq", "entity", "member"]);
    expect(calls).toContainEqual(["eq", "entity_id", IGOR]);
    expect(calls).toContainEqual(["in", "action", ["create", "update", "delete", "restore"]]);
    expect(fakeRpcs()[0].args).toEqual({ _record_type: "member", _record_id: IGOR });

    expect(screen.queryByRole("combobox", { name: "Entidade" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Status" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Entidade" })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Ação" }), { key: "Enter" });
    const options = (await screen.findAllByRole("option")).map((option) => option.textContent);
    expect(options).toEqual(["Todas", "Criação", "Alteração", "Exclusão", "Restauração"]);
  });

  it("UX-24: no histórico do mesmo registro, o painel não oferece 'Ver histórico deste membro'", async () => {
    respondToRpc("audit_record_label", { data: [{ name: "Igor Nunes", leader_name: null, report_date: null, deleted: false }] });
    respondWith({ data: [igorChange], count: 1 });
    renderPage(historyUrl);
    fireEvent.click(await screen.findByRole("button", { name: "Alterou o membro Igor Nunes" }));
    const sheet = within(await screen.findByRole("dialog", { name: "Detalhes do evento" }));
    expect(sheet.queryByRole("link", { name: "Ver histórico deste membro" })).not.toBeInTheDocument();
  });

  it("UX-24: na Auditoria toda, o painel do membro leva ao histórico dele", async () => {
    respondWith({ data: [igorChange], count: 1 });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Alterou o membro Igor Nunes" }));
    const sheet = within(await screen.findByRole("dialog", { name: "Detalhes do evento" }));
    expect(sheet.getByRole("link", { name: "Ver histórico deste membro" })).toHaveAttribute("href", historyUrl);
  });

  it("UX-23: sem eventos, o texto da T9 e 'Ver toda a Auditoria'; registro excluído com o badge", async () => {
    respondToRpc("audit_record_label", { data: [{ name: null, leader_name: "Carla Dias", report_date: null, deleted: true }] });
    respondWith({ data: [], count: 0 });
    renderPage(`/events?record_type=cell&record_id=${IGOR}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Histórico da célula de Carla Dias" })).toBeInTheDocument();
    expect(screen.getByText("Célula excluída")).toBeInTheDocument();
    expect(await screen.findByText("Nenhum evento desta célula na Auditoria.")).toBeInTheDocument();
    expect(
      screen.getByText("As alterações feitas no sistema anterior não estão na Auditoria, e os eventos com mais de 2 anos já saíram."),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Ver toda a Auditoria" })).toHaveLength(2);
  });

  it("registro que não se identifica: 'Histórico do registro'; o do relatório traz a data e o líder", async () => {
    respondToRpc("audit_record_label", { data: [] });
    respondWith({ data: [], count: 0 });
    renderPage(historyUrl);
    expect(await screen.findByRole("heading", { level: 1, name: "Histórico do registro" })).toBeInTheDocument();
  });
});

describe("UX-25, UX-27: cabeçalho, carregando e erro", () => {
  it("o h1, o subtítulo e a nota de guarda na Auditoria toda", async () => {
    respondWith({ data: [], count: 0 });
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Auditoria" })).toBeInTheDocument();
    expect(screen.getByText("Eventos de toda a igreja")).toBeInTheDocument();
    expect(screen.getByTestId("retention-note")).toBeInTheDocument();
    expect(await screen.findByText("Nenhum evento registrado.")).toBeInTheDocument();
  });

  it("enquanto carrega, 5 Skeleton; na falha, o Alert com 'Tentar de novo', e a busca continua", async () => {
    let release: () => void = () => {};
    const until = new Promise<void>((resolve) => {
      release = resolve;
    });
    respondWith({ data: null, error: { code: "08006", message: "rede" }, until }, { data: [igorChange], count: 1 });
    renderPage();
    expect(screen.getByTestId("audit-loading").children).toHaveLength(5);
    release();
    expect(await screen.findByText("Não foi possível carregar a Auditoria. Verifique a conexão e tente de novo.")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Buscar" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByText("Alterou o membro Igor Nunes")).toBeInTheDocument();
  });
});
