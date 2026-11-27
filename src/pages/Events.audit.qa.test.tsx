import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeQueries, fakeRpcs, resetFakeSupabase, respondToRpc, respondWith, type FakeQuery } from "@/test/fake-supabase";
import Events from "./Events";

// QA do E2.05 (PRs 3 e 4, tarefa 16): lacunas dos testes do desenvolvedor. Corrida entre filtros
// (a resposta atrasada não sobrescreve a nova), histórico ignorando filtros que não valem,
// período invertido vindo da URL, campos sensíveis sem valor mesmo se o payload os trouxer e autor
// ausente. As regras: RN-18, RN-19, RN-20 e UX-12, UX-14, UX-19, UX-21, UX-22, UX-30.

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
  occurred_at: "2026-11-24T00:50:00Z",
  seq: 1,
  actor_kind: "member",
  actor_label: "Bruno Lima",
  action: "update",
  entity: "member",
  entity_id: IGOR,
  entity_label: "Igor Nunes",
  description: "Alterou o membro Igor Nunes",
  changed_fields: ["leader_id"],
  changes: { fields: [{ field: "leader_id", from: "Bruno Lima", to: "Pedro Alves" }] },
  metadata: {},
  success: true,
  error_reason: null,
  ...overrides,
});

const originalWidth = window.innerWidth;
const setWidth = (width: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: width });

function Where() {
  return <p data-testid="where">{useLocation().search}</p>;
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

const pageQueries = (): FakeQuery[] => fakeQueries().filter((query) => query.methods().includes("range"));

beforeEach(() => {
  resetFakeSupabase();
  setWidth(1280);
});
afterEach(() => setWidth(originalWidth));

describe("UX-12: corrida entre filtros", () => {
  it("Dado um filtro lento e um segundo filtro rápido, quando o lento responde por último, então a lista mostra só o resultado do segundo", async () => {
    let releaseSlow: () => void = () => {};
    const slow = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    const first = event({ id: "e-first", description: "Alterou o membro Primeiro" });
    const slowRow = event({ id: "e-slow", description: "Alterou o membro Lento" });
    const fastRow = event({ id: "e-fast", description: "Alterou o membro Rápido" });
    // 1ª: carga inicial; 2ª: filtro "Erro" (lenta); 3ª: filtro "Sucesso" (rápida).
    respondWith({ data: [first], count: 1 }, { data: [slowRow], count: 1, until: slow }, { data: [fastRow], count: 1 });
    renderPage();
    await screen.findByText("Alterou o membro Primeiro");

    fireEvent.keyDown(screen.getByRole("combobox", { name: "Status" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "Erro" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\?status=error$/));
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Status" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "Sucesso" }));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\?status=success$/));
    await screen.findByText("Alterou o membro Rápido");

    releaseSlow();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByText("Alterou o membro Rápido")).toBeInTheDocument();
    expect(screen.queryByText("Alterou o membro Lento")).not.toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent(/^\?status=success$/);
  });
});

describe("RN-19 e T9: o histórico ignora o que não vale nele", () => {
  const historyUrl = `/events?record_type=member&record_id=${IGOR}`;

  it("Dado entity, status e uma ação de login na URL do histórico, então nada disso vai ao servidor e a URL fica limpa", async () => {
    respondToRpc("audit_record_label", { data: [{ name: "Igor Nunes", leader_name: null, report_date: null, deleted: false }] });
    respondWith({ data: [], count: 0 });
    renderPage(`${historyUrl}&entity=cell&status=error&action=login_failed`);
    await screen.findByRole("heading", { level: 1, name: "Histórico de Igor Nunes" });
    await waitFor(() => expect(pageQueries().length).toBeGreaterThan(0));
    const calls = pageQueries().flatMap((query) => query.calls);
    expect(calls).not.toContainEqual(["eq", "entity", "cell"]);
    expect(calls.filter(([method, column]) => method === "eq" && column === "success")).toHaveLength(0);
    expect(calls.filter(([method, column]) => method === "eq" && column === "action")).toHaveLength(0);
    expect(calls).toContainEqual(["eq", "entity", "member"]);
    expect(calls).toContainEqual(["in", "action", ["create", "update", "delete", "restore"]]);
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(`?record_type=member&record_id=${IGOR}`));
    expect(screen.getByTestId("where").textContent).not.toMatch(/entity=|status=|action=/);
  });

  it("Dado um record_type inválido, então vira a Auditoria toda (sem histórico) e os parâmetros do registro saem da URL", async () => {
    respondWith({ data: [], count: 0 });
    renderPage(`/events?record_type=banana&record_id=${IGOR}`);
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^$/));
    expect(screen.getByRole("heading", { level: 1, name: "Auditoria" })).toBeInTheDocument();
    expect(fakeRpcs().filter((rpc) => rpc.fn === "audit_record_label")).toHaveLength(0);
    expect(pageQueries().flatMap((query) => query.calls)).not.toContainEqual(["eq", "entity_id", IGOR]);
  });

  it("Dado o histórico, quando muda a ação, então o período e o registro continuam na consulta", async () => {
    respondToRpc("audit_record_label", { data: [{ name: "Igor Nunes", leader_name: null, report_date: null, deleted: false }] });
    respondWith({ data: [], count: 0 }, { data: [], count: 0 });
    renderPage(`${historyUrl}&from=2026-11-01`);
    await screen.findByRole("heading", { level: 1, name: "Histórico de Igor Nunes" });
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Ação" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "Exclusão" }));
    await waitFor(() => expect(pageQueries().length).toBeGreaterThan(1));
    const calls = pageQueries()[pageQueries().length - 1].calls;
    expect(calls).toContainEqual(["eq", "action", "delete"]);
    expect(calls).toContainEqual(["eq", "entity_id", IGOR]);
    expect(calls).toContainEqual(["gte", "occurred_on", "2026-11-01"]);
  });
});

describe("UX-14: período invertido vindo da URL", () => {
  it("Dado ?from=2026-11-15&to=2026-11-10, então o 'Até' inválido sai da URL e a consulta só leva o 'De'", async () => {
    respondWith({ data: [], count: 0 });
    renderPage("/events?from=2026-11-15&to=2026-11-10");
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\?from=2026-11-15$/));
    const calls = pageQueries().flatMap((query) => query.calls);
    expect(calls).toContainEqual(["gte", "occurred_on", "2026-11-15"]);
    expect(calls.filter(([method]) => method === "lte")).toHaveLength(0);
  });
});

describe("UX-19, UX-30 e RN-20: campos sensíveis nunca mostram valor", () => {
  it("Dado um payload que traz CPF, e-mail e nascimento com from/to, então o painel lista só os rótulos e nenhum valor", async () => {
    const sensitive = event({
      changed_fields: ["cpf", "email", "birth_date", "notes", "visitors"],
      changes: {
        fields: [
          { field: "birth_date", from: "1990-01-02", to: "1991-03-04" },
          { field: "cpf", from: "11144477735", to: "52998224725" },
          { field: "email", from: "igor@exemplo.com", to: "novo@exemplo.com" },
          { field: "notes", from: "segredo antigo", to: "segredo novo" },
          { field: "name", from: "Igor Nunes", to: "Igor N. Nunes" },
        ],
      },
    });
    respondWith({ data: [sensitive], count: 1 });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Alterou o membro Igor Nunes" }));
    const sheet = within(await screen.findByRole("dialog", { name: "Detalhes do evento" }));
    for (const label of ["CPF", "E-mail", "Data de nascimento", "Observações"]) {
      const item = sheet.getByText(label).closest("li");
      expect(item).not.toBeNull();
      expect(item?.textContent).toBe(label);
    }
    expect(sheet.getByText(/^Nome:/).closest("li")).toHaveTextContent("Nome: Igor Nunes → Igor N. Nunes");
    const text = document.body.textContent ?? "";
    for (const value of ["11144477735", "52998224725", "igor@exemplo.com", "novo@exemplo.com", "segredo", "1990", "1991"]) {
      expect(text).not.toContain(value);
    }
  });

  it("Dado um campo fora da lista (de um passo futuro), então o painel não mostra o nome técnico", async () => {
    const future = event({
      changes: { fields: [{ field: "campo_futuro_xyz", from: "a", to: "b" }, { field: "leader_id", from: "Bruno Lima", to: "Pedro Alves" }] },
    });
    respondWith({ data: [future], count: 1 });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Alterou o membro Igor Nunes" }));
    await screen.findByRole("dialog", { name: "Detalhes do evento" });
    expect(document.body.textContent).not.toContain("campo_futuro_xyz");
  });
});

describe("UX-21: o autor ausente ou de uma pessoa excluída", () => {
  it("Dado o autor com actor_kind 'member' e sem nome, então '—'; com o nome de quem foi excluído, o nome só como texto (sem link)", async () => {
    const noLabel = event({ id: "n1", actor_label: null, description: "Alterou o membro Sem Autor" });
    const deletedAuthor = event({ id: "n2", actor_label: "Ex-Líder Excluído", description: "Alterou o membro Com Autor Excluído" });
    respondWith({ data: [noLabel, deletedAuthor], count: 2 });
    renderPage();
    const rows = within(await screen.findByTestId("audit-event-table")).getAllByRole("row").slice(1);
    expect(within(rows[0]).getAllByRole("cell")[1]).toHaveTextContent(/^—$/);
    const authorCell = within(rows[1]).getAllByRole("cell")[1];
    expect(authorCell).toHaveTextContent(/^Ex-Líder Excluído$/);
    expect(within(authorCell).queryByRole("link")).not.toBeInTheDocument();
  });
});
