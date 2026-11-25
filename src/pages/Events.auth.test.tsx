import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeQueries, resetFakeSupabase, respondWith } from "@/test/fake-supabase";
import Events from "./Events";

// Auditoria dos eventos de login (E1.04, PR 2): UX-15 (ação "Login (bloqueio)"
// e filtro), UX-16 (segunda linha) e UX-17 (painel), RN-15. As linhas seguem o
// que `sign_in_attempt` grava de verdade (metadata com chaves estáveis, a
// identificação inválida só como "***", sem origem em lugar nenhum).

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

vi.mock("@/components/AppLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    permissionsLoaded: true,
    hasPermission: (...permissions: string[]) => permissions.includes("view_audit_log"),
  }),
}));

const base = {
  occurred_at: "2026-11-24T13:05:00Z",
  actor_user_id: null,
  actor_label: null,
  entity: "auth",
  changed_fields: null,
};

const failureWrongPassword = {
  ...base,
  id: "f1",
  action: "login_failed",
  entity_id: "m-1",
  entity_label: "Ana Souza",
  description: "Falha no login",
  metadata: { reason: "wrong_password", identifier_type: "email", identifier_masked: "a***@teste.invalid" },
  success: false,
  error_reason: "Senha incorreta",
};

const failureInvalid = {
  ...base,
  id: "f2",
  action: "login_failed",
  entity_id: null,
  entity_label: null,
  description: "Falha no login",
  metadata: { reason: "invalid_identifier", identifier_masked: "***" },
  success: false,
  error_reason: "Identificação inválida",
};

const blockByIdentifier = {
  ...base,
  id: "b1",
  action: "login_blocked",
  entity_id: "m-1",
  entity_label: "Ana Souza",
  description: "Login bloqueado por excesso de tentativas",
  metadata: { block_scope: "identifier", block_minutes: 15, identifier_type: "cpf", identifier_masked: "***.***.***-09" },
  success: false,
  error_reason: null,
};

const blockByOrigin = {
  ...base,
  id: "b2",
  action: "login_blocked",
  entity_id: null,
  entity_label: null,
  description: "Login bloqueado por excesso de tentativas",
  metadata: { block_scope: "origin", block_minutes: 1 },
  success: false,
  error_reason: null,
};

const loginOk = {
  ...base,
  id: "l1",
  action: "login",
  actor_user_id: "u-1",
  actor_label: "Ana Souza",
  entity_id: "u-1",
  entity_label: "Ana Souza",
  description: "Login realizado",
  metadata: {},
  success: true,
  error_reason: null,
};

const updateMember = {
  ...base,
  id: "u1",
  action: "update",
  entity: "member",
  actor_user_id: "u-ad",
  actor_label: "Elisa Martins",
  entity_id: "m-9",
  entity_label: "Davi Lima",
  description: "Atualizou o membro Davi Lima",
  changed_fields: ["name"],
  metadata: { before: { name: "Davi" } },
  success: false,
  error_reason: "falha qualquer",
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Events />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const actionFilter = () => {
  const block = screen.getByText("Ação", { selector: "label" }).parentElement;
  if (!block) throw new Error("sem o bloco do filtro Ação");
  return within(block).getByRole("combobox");
};

beforeEach(() => {
  resetFakeSupabase();
});

describe("UX-15: ação 'Login (bloqueio)'", () => {
  it("Dado um evento login_blocked, então a linha e o painel mostram 'Login (bloqueio)', e não o código", async () => {
    respondWith({ data: [blockByIdentifier] });
    renderPage();

    const row = (await screen.findByText("Login bloqueado por excesso de tentativas")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Login (bloqueio)")).toBeInTheDocument();
    expect(within(row).queryByText("login_blocked")).not.toBeInTheDocument();

    fireEvent.click(row);
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText("Login (bloqueio)")).toBeInTheDocument();
  });

  it("o filtro 'Ação' tem a opção entre 'Login (falha)' e 'Logout'", async () => {
    respondWith({ data: [blockByIdentifier] });
    renderPage();
    await screen.findByText("Login bloqueado por excesso de tentativas");

    fireEvent.keyDown(actionFilter(), { key: "Enter" });
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent);
    const failure = options.indexOf("Login (falha)");
    expect(failure).toBeGreaterThan(-1);
    expect(options[failure + 1]).toBe("Login (bloqueio)");
    expect(options[failure + 2]).toBe("Logout");
  });

  it("escolher a opção consulta o banco só pela ação login_blocked", async () => {
    respondWith({ data: [blockByIdentifier, failureWrongPassword] }, { data: [blockByIdentifier] });
    renderPage();
    await screen.findByText("Login bloqueado por excesso de tentativas");

    fireEvent.keyDown(actionFilter(), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "Login (bloqueio)" }));

    await waitFor(() => expect(fakeQueries()).toHaveLength(2));
    expect(fakeQueries()[1].calls).toContainEqual(["eq", "action", "login_blocked"]);
    await waitFor(() => expect(screen.queryByText("Falha no login")).not.toBeInTheDocument());
    expect(actionFilter()).toHaveTextContent("Login (bloqueio)");
  });
});

describe("UX-16: segunda linha da descrição", () => {
  it("Login (falha): o motivo e o nome do cadastro, com o autor '—'", async () => {
    respondWith({ data: [failureWrongPassword] });
    renderPage();

    const row = (await screen.findByText("Falha no login")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Senha incorreta · Ana Souza")).toBeInTheDocument();
    expect(within(row).getByText("—")).toBeInTheDocument();
    expect(within(row).getByText("Login (falha)")).toBeInTheDocument();
  });

  it("Login (falha) sem cadastro ligado: só o motivo", async () => {
    respondWith({ data: [failureInvalid] });
    renderPage();

    const row = (await screen.findByText("Falha no login")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Identificação inválida")).toBeInTheDocument();
    expect(row.textContent).not.toContain("·");
  });

  it("Login (bloqueio) por identificação: tipo, duração e cadastro", async () => {
    respondWith({ data: [blockByIdentifier] });
    renderPage();
    const row = (await screen.findByText("Login bloqueado por excesso de tentativas")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Por identificação · 15 minutos · Ana Souza")).toBeInTheDocument();
  });

  it("Login (bloqueio) por origem: 'Por origem · 1 minuto' (singular), sem cadastro", async () => {
    respondWith({ data: [blockByOrigin] });
    renderPage();
    const row = (await screen.findByText("Login bloqueado por excesso de tentativas")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Por origem · 1 minuto")).toBeInTheDocument();
  });

  it("os outros eventos (login ok e atualização de membro) ficam sem segunda linha", async () => {
    respondWith({ data: [loginOk, updateMember] });
    renderPage();

    const okRow = (await screen.findByText("Login realizado")).closest("tr") as HTMLElement;
    expect(okRow.querySelectorAll("span.block")).toHaveLength(0);
    const updRow = screen.getByText("Atualizou o membro Davi Lima").closest("tr") as HTMLElement;
    expect(updRow.querySelectorAll("span.block")).toHaveLength(0);
  });

  it("um motivo desconhecido no metadata cai no texto de error_reason, sem quebrar", async () => {
    respondWith({ data: [{ ...failureWrongPassword, metadata: { reason: "novo_motivo" } }] });
    renderPage();
    const row = (await screen.findByText("Falha no login")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Senha incorreta · Ana Souza")).toBeInTheDocument();
  });
});

describe("UX-17: painel do evento de autenticação", () => {
  async function openPanel(event: object) {
    respondWith({ data: [event] });
    renderPage();
    const row = (await screen.findAllByRole("row"))[1];
    await waitFor(() => expect(within(screen.getAllByRole("row")[1]).queryByText("Carregando...")).toBeNull());
    fireEvent.click(screen.getAllByRole("row")[1] ?? row);
    return within(await screen.findByRole("dialog"));
  }

  it("falha com cadastro: mostra Cadastro, Motivo, Tipo de identificação e Identificação (mascarada), sem Metadados nem Erro", async () => {
    const panel = await openPanel(failureWrongPassword);

    expect(panel.getByText("Cadastro")).toBeInTheDocument();
    expect(panel.getByText("Ana Souza")).toBeInTheDocument();
    expect(panel.getByText("Motivo")).toBeInTheDocument();
    expect(panel.getByText("Senha incorreta")).toBeInTheDocument();
    expect(panel.getByText("Tipo de identificação")).toBeInTheDocument();
    expect(panel.getByText("E-mail")).toBeInTheDocument();
    expect(panel.getByText("Identificação")).toBeInTheDocument();
    expect(panel.getByText("a***@teste.invalid")).toBeInTheDocument();
    expect(panel.queryByText("Tipo de bloqueio")).not.toBeInTheDocument();
    expect(panel.queryByText("Duração")).not.toBeInTheDocument();
    expect(panel.queryByText("Metadados")).not.toBeInTheDocument();
    expect(panel.queryByText("Erro")).not.toBeInTheDocument();
    expect(document.querySelector("pre")).toBeNull();
  });

  it("identificação inválida: aparece só '***', sem Cadastro nem Tipo de identificação", async () => {
    const panel = await openPanel(failureInvalid);

    expect(panel.getByText("Identificação")).toBeInTheDocument();
    expect(panel.getByText("***")).toBeInTheDocument();
    expect(panel.getByText("Identificação inválida")).toBeInTheDocument();
    expect(panel.queryByText("Cadastro")).not.toBeInTheDocument();
    expect(panel.queryByText("Tipo de identificação")).not.toBeInTheDocument();
  });

  it("bloqueio por identificação: mostra Tipo de bloqueio e Duração, com o 15 minutos", async () => {
    const panel = await openPanel(blockByIdentifier);

    expect(panel.getByText("Tipo de bloqueio")).toBeInTheDocument();
    expect(panel.getByText("Por identificação")).toBeInTheDocument();
    expect(panel.getByText("Duração")).toBeInTheDocument();
    expect(panel.getByText("15 minutos")).toBeInTheDocument();
    expect(panel.getByText("CPF")).toBeInTheDocument();
    expect(panel.getByText("***.***.***-09")).toBeInTheDocument();
    expect(panel.queryByText("Motivo")).not.toBeInTheDocument();
    expect(panel.queryByText("Metadados")).not.toBeInTheDocument();
  });

  it("bloqueio por origem: só Tipo de bloqueio e Duração, e a origem não aparece em lugar nenhum", async () => {
    const panel = await openPanel({ ...blockByOrigin, metadata: { ...blockByOrigin.metadata, origin: "203.0.113.7", ip: "203.0.113.7" } });

    expect(panel.getByText("Por origem")).toBeInTheDocument();
    expect(panel.getByText("1 minuto")).toBeInTheDocument();
    expect(panel.queryByText("Cadastro")).not.toBeInTheDocument();
    expect(panel.queryByText("Identificação")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("203.0.113.7");
    expect(document.body.textContent).not.toMatch(/\borigin\b/);
  });

  it("os outros eventos ficam como estão: Metadados em JSON, Erro e Identificação", async () => {
    const panel = await openPanel(updateMember);

    expect(panel.getByText("Metadados")).toBeInTheDocument();
    expect(document.querySelector("pre")).not.toBeNull();
    expect(panel.getByText("Erro")).toBeInTheDocument();
    expect(panel.getByText("falha qualquer")).toBeInTheDocument();
    expect(panel.getByText("Identificação")).toBeInTheDocument();
    expect(panel.getByText("Davi Lima")).toBeInTheDocument();
    expect(panel.getByText("Campos alterados")).toBeInTheDocument();
  });
});
