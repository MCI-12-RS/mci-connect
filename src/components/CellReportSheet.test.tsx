import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeQueries, resetFakeSupabase, respondWith } from "@/test/fake-supabase";
import type { CellReportDetailRow, ReportParticipant } from "@/lib/cell-reports/fields";
import CellReportSheet from "./CellReportSheet";

// O `Sheet` "Relatório" (E2.01, T7): consulta do relatório de célula excluída
// (RN-09 b, RN-11, RN-13; "Estados"; UX-26 e UX-27).

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

const report = (overrides: Partial<CellReportDetailRow> = {}): CellReportDetailRow => ({
  id: "r1",
  date: "2026-11-19",
  time: "20:00:00",
  theme: "Fé que move montanhas",
  observations: null,
  visitors: ["João", "Maria"],
  offering: 50,
  was_held: true,
  reason_not_held: null,
  cell_leader_name: "Carlos Lima",
  cell_deleted: true,
  ...overrides,
});

const ANA: ReportParticipant = { member_id: "m1", member_name: "Ana Souza", member_deleted: false };
const SARA: ReportParticipant = { member_id: "m9", member_name: "Sara Reis", member_deleted: true };

// O Intl separa o "R$" do valor com um espaço inseparável.
const brl = (text: string) => text.replace(" ", " ");

function renderSheet({
  reportId = "r1",
  open,
  canSeeDeletedCells = false,
  onClose = vi.fn(),
}: { reportId?: string | null; open?: boolean; canSeeDeletedCells?: boolean; onClose?: () => void } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (isOpen: boolean | undefined) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CellReportSheet reportId={reportId} open={isOpen} onClose={onClose} canSeeDeletedCells={canSeeDeletedCells} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const result = render(tree(open));
  return { onClose, setOpen: (isOpen: boolean) => result.rerender(tree(isOpen)) };
}

/** O valor de um campo do painel (`<dt>` e o `<dd>` seguinte). */
function field(dialog: HTMLElement, label: string): HTMLElement {
  const term = within(dialog).getByText(label, { selector: "dt" });
  const value = term.nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new Error(`campo sem valor: ${label}`);
  return value;
}

const termsOf = (dialog: HTMLElement) => Array.from(dialog.querySelectorAll("dt")).map((dt) => dt.textContent);

describe("CellReportSheet: relatório de célula excluída", () => {
  beforeEach(() => resetFakeSupabase());

  it("Realizada: cabeçalho, aviso da RN-11 e os campos, com a oferta em BRL e a largura toda no celular (UX-27)", async () => {
    respondWith({ data: report() }, { data: [ANA, SARA] });
    renderSheet();

    const dialog = await screen.findByRole("dialog", { name: "Relatório de 19/11/2026" });
    expect(dialog).toHaveAccessibleDescription("Célula de Carlos Lima");
    expect(dialog).toHaveClass("w-full", "sm:max-w-lg");
    expect(within(dialog).getByText("Célula excluída")).toBeInTheDocument();
    // O aviso é uma nota, e não um alerta: não é um erro.
    const notice = within(dialog).getByRole("note");
    expect(notice).toHaveTextContent("A célula deste relatório foi excluída. Restaure a célula para editar o relatório.");

    expect(termsOf(dialog)).toEqual([
      "Data e hora",
      "Situação",
      "Tema",
      "Participantes (2)",
      "Visitantes (2)",
      "Oferta",
      "Observações",
    ]);
    expect(field(dialog, "Data e hora")).toHaveTextContent("Quinta, 19/11/2026 às 20:00");
    expect(field(dialog, "Situação")).toHaveTextContent("Realizada");
    expect(field(dialog, "Tema")).toHaveTextContent("Fé que move montanhas");
    expect(within(field(dialog, "Participantes (2)")).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Ana Souza",
      "Sara Reis",
    ]);
    expect(field(dialog, "Visitantes (2)")).toHaveTextContent("João, Maria");
    expect(field(dialog, "Oferta").textContent).toBe(brl("R$ 50,00"));
    expect(field(dialog, "Observações")).toHaveTextContent("Não informado");

    // Só consulta: sem "Editar relatório" (E2.12) e sem link para o cadastro de ninguém.
    expect(within(dialog).queryByRole("button", { name: /Editar/ })).not.toBeInTheDocument();
    expect(within(dialog).queryAllByRole("link")).toHaveLength(0);
  });

  it("O '✕' se chama 'Fechar', tem 44 px e fecha; o do SheetContent é o último filho, que fica escondido", async () => {
    respondWith({ data: report() }, { data: [] });
    const { onClose } = renderSheet();

    const dialog = await screen.findByRole("dialog", { name: "Relatório de 19/11/2026" });
    const close = within(dialog).getAllByRole("button", { name: "Fechar" })[0];
    expect(close).toHaveClass("h-11", "w-11");
    // O do SheetContent também se chama "Fechar", mas é o último filho (no jsdom, sem o CSS que o esconde).
    expect(within(dialog).getAllByRole("button", { name: "Fechar" })).toHaveLength(2);
    // O jsdom não aplica o CSS: confere que a regra que esconde o "✕" do SheetContent o alcança.
    expect(dialog).toHaveClass("[&>button:last-child]:hidden");
    expect(dialog.lastElementChild).toHaveAccessibleName("Fechar");

    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("O foco vai para o painel, e não para o primeiro link", async () => {
    respondWith({ data: report() }, { data: [] });
    renderSheet({ canSeeDeletedCells: true });

    const dialog = await screen.findByRole("dialog", { name: "Relatório de 19/11/2026" });
    await waitFor(() => expect(dialog).toHaveFocus());
  });

  it("Administrador: 'Ver células excluídas' abre a lista de células excluídas buscando o líder (UX-26)", async () => {
    respondWith({ data: report() }, { data: [] });
    renderSheet({ canSeeDeletedCells: true });

    const dialog = await screen.findByRole("dialog", { name: "Relatório de 19/11/2026" });
    const link = within(dialog).getByRole("link", { name: "Ver células excluídas" });
    expect(link).toHaveAttribute("href", "/cells/deleted?q=Carlos+Lima");
    expect(within(dialog).getByRole("note")).toContainElement(link);
  });

  it("Sem manage_roles: o aviso aparece, sem 'Ver células excluídas'", async () => {
    respondWith({ data: report() }, { data: [] });
    renderSheet({ canSeeDeletedCells: false });

    const dialog = await screen.findByRole("dialog", { name: "Relatório de 19/11/2026" });
    expect(within(dialog).getByRole("note")).toBeInTheDocument();
    expect(within(dialog).queryByRole("link", { name: "Ver células excluídas" })).not.toBeInTheDocument();
  });

  it("Participante excluído: aparece só pelo nome e conta no total (RN-13)", async () => {
    respondWith({ data: report() }, { data: [SARA] });
    renderSheet();

    const dialog = await screen.findByRole("dialog", { name: "Relatório de 19/11/2026" });
    const participants = field(dialog, "Participantes (1)");
    expect(within(participants).getByText("Sara Reis")).toBeInTheDocument();
    expect(participants).not.toHaveTextContent("excluído");
    expect(within(participants).queryByRole("link")).not.toBeInTheDocument();
  });

  it("'Não houve célula': situação 'Não realizada' e o motivo, sem tema, participantes, visitantes e oferta", async () => {
    respondWith({ data: report({ was_held: false, theme: null, reason_not_held: "Chuva forte", observations: "Remarcada" }) }, { data: [ANA] });
    renderSheet();

    const dialog = await screen.findByRole("dialog", { name: "Relatório de 19/11/2026" });
    expect(termsOf(dialog)).toEqual(["Data e hora", "Situação", "Motivo", "Observações"]);
    expect(field(dialog, "Situação")).toHaveTextContent("Não realizada");
    expect(field(dialog, "Motivo")).toHaveTextContent("Chuva forte");
    expect(field(dialog, "Observações")).toHaveTextContent("Remarcada");
    expect(within(dialog).queryByText("Ana Souza")).not.toBeInTheDocument();
  });

  it("Vazio: 'Não informado' nos campos vazios, 'Participantes (0)' com 'Nenhum membro.' e 'Visitantes (0)' com 'Nenhum visitante.'", async () => {
    respondWith({ data: report({ theme: null, visitors: [], offering: null }) }, { data: [] });
    renderSheet();

    const dialog = await screen.findByRole("dialog", { name: "Relatório de 19/11/2026" });
    expect(field(dialog, "Tema")).toHaveTextContent("Não informado");
    expect(field(dialog, "Participantes (0)")).toHaveTextContent("Nenhum membro.");
    expect(field(dialog, "Visitantes (0)")).toHaveTextContent("Nenhum visitante.");
    expect(field(dialog, "Oferta")).toHaveTextContent("Não informado");
    expect(field(dialog, "Observações")).toHaveTextContent("Não informado");
  });

  it("Carregando: Skeleton do cabeçalho e de 6 linhas, com o painel nomeado 'Relatório'", async () => {
    let release: () => void = () => {};
    const until = new Promise<void>((resolve) => {
      release = resolve;
    });
    respondWith({ data: report(), until }, { data: [], until });
    renderSheet();

    const dialog = await screen.findByRole("dialog", { name: "Relatório" });
    const busy = dialog.querySelector('[aria-busy="true"]');
    expect(busy).not.toBeNull();
    expect(busy?.querySelectorAll(".animate-pulse")).toHaveLength(9);
    expect(dialog).toHaveTextContent("Carregando o relatório…");

    release();
    expect(await screen.findByRole("dialog", { name: "Relatório de 19/11/2026" })).toBeInTheDocument();
  });

  it("Erro: 'Não foi possível carregar o relatório.' e 'Tentar de novo', que consulta de novo", async () => {
    respondWith({ data: report() }, { error: { code: "XX000", message: "falhou" } });
    renderSheet();

    const dialog = await screen.findByRole("dialog", { name: "Relatório" });
    const alert = await within(dialog).findByRole("alert");
    expect(alert).toHaveTextContent("Não foi possível carregar o relatório.");
    expect(alert).not.toHaveTextContent("falhou");

    let release: () => void = () => {};
    const until = new Promise<void>((resolve) => {
      release = resolve;
    });
    respondWith({ data: report(), until }, { data: [ANA], until });
    fireEvent.click(within(alert).getByRole("button", { name: "Tentar de novo" }));
    // O carregando aparece no toque, e o botão sai da tela: o foco fica no painel (QA-E201-PR4-1).
    expect(dialog).toHaveTextContent("Carregando o relatório…");
    expect(within(dialog).queryByRole("button", { name: "Tentar de novo" })).not.toBeInTheDocument();
    expect(dialog).toHaveFocus();

    release();
    expect(await screen.findByRole("dialog", { name: "Relatório de 19/11/2026" })).toBeInTheDocument();
    expect(fakeQueries()).toHaveLength(4);
  });

  it("Erro de novo: 'Tentar de novo' que falha outra vez volta a mostrar o erro e o botão", async () => {
    respondWith({ data: report() }, { error: { code: "XX000", message: "falhou" } });
    renderSheet();
    const dialog = await screen.findByRole("dialog", { name: "Relatório" });
    const retry = await within(dialog).findByRole("button", { name: "Tentar de novo" });

    respondWith({ data: report() }, { error: { code: "XX000", message: "falhou de novo" } });
    fireEvent.click(retry);
    expect(dialog).toHaveTextContent("Carregando o relatório…");

    expect(await within(dialog).findByRole("button", { name: "Tentar de novo" })).toBeInTheDocument();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Não foi possível carregar o relatório.");
    expect(fakeQueries()).toHaveLength(4);
  });

  it("Relatório que sumiu (excluído no meio tempo): 'Este relatório não existe ou já foi excluído.' e 'Fechar'", async () => {
    respondWith({ data: null }, { data: [] });
    const { onClose } = renderSheet();

    const dialog = await screen.findByRole("dialog", { name: "Relatório" });
    await waitFor(() => expect(dialog).toHaveAccessibleDescription("Este relatório não existe ou já foi excluído."));
    expect(within(dialog).queryByText("Célula excluída")).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByText("Fechar", { selector: "button" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Com open=false, lê o relatório sem aparecer; ao abrir, mostra o que leu, sem ler de novo", async () => {
    respondWith({ data: report() }, { data: [ANA] });
    const { setOpen } = renderSheet({ open: false });

    await waitFor(() => expect(fakeQueries()).toHaveLength(2));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    setOpen(true);
    expect(await screen.findByRole("dialog", { name: "Relatório de 19/11/2026" })).toBeInTheDocument();
    expect(fakeQueries()).toHaveLength(2);
  });

  it("Sem relatório (reportId null): fechado, sem consultar nada", () => {
    renderSheet({ reportId: null });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(fakeQueries()).toHaveLength(0);
  });
});
