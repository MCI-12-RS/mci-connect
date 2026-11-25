import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { fakeQueries, resetFakeSupabase, respondWith } from "@/test/fake-supabase";
import { ROLE_TEXTS } from "@/lib/access/texts";
import Roles from "./Roles";

// Tela de Funções (E2.02, T2): leitura só pela roles_view, Administrador só
// para leitura, cards no celular e tabela no desktop, erro com "Tentar de
// novo". Os critérios UX-01 a UX-05 ficam nos testes do QA.

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

vi.mock("@/components/AppLayout", () => ({ default: ({ children }: { children: ReactNode }) => <>{children}</> }));

const auth = vi.hoisted(() => ({ permissions: new Set<string>() }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    hasPermission: (...permissions: string[]) => permissions.some((p) => auth.permissions.has(p)),
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const ROWS = [
  {
    id: "mem",
    name: "Membro",
    description: "Vê o seu ministério.",
    is_protected: false,
    is_default: true,
    permissions: ["view_own_ministry", "view_dashboard"],
    members_count: 5,
    updated_at: "2026-11-25T12:00:00+00:00",
  },
  {
    id: "adm",
    name: "Administrador",
    description: "Acesso total ao sistema, em toda a igreja.",
    is_protected: true,
    is_default: false,
    permissions: ["view_all_church", "view_audit_log"],
    members_count: 1,
    updated_at: "2026-11-25T12:00:00+00:00",
  },
  {
    id: "apo",
    name: "Apoio",
    description: null,
    is_protected: false,
    is_default: false,
    permissions: [],
    members_count: 0,
    updated_at: "2026-11-25T12:00:00+00:00",
  },
];

function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Roles />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const originalWidth = window.innerWidth;

beforeAll(() => vi.stubGlobal("ResizeObserver", NoopResizeObserver));
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  resetFakeSupabase();
  auth.permissions = new Set(["manage_roles"]);
});
afterEach(() => setWidth(originalWidth));

describe("Roles (T2)", () => {
  it("lê só da roles_view", async () => {
    setWidth(1280);
    respondWith({ data: ROWS });
    renderPage();
    await screen.findByText("Apoio");
    expect(fakeQueries().map((query) => query.table)).toEqual(["roles_view"]);
  });

  it("desktop: Administrador primeiro, sem ações e com a frase no lugar das permissões", async () => {
    setWidth(1280);
    respondWith({ data: ROWS });
    renderPage();
    const rows = await screen.findAllByRole("row");
    const [adminRow, supportRow, memberRow] = rows.slice(1);
    expect(within(adminRow).getByText("Administrador")).toBeInTheDocument();
    expect(within(adminRow).getByText(ROLE_TEXTS.adminDescription)).toBeInTheDocument();
    expect(within(adminRow).queryAllByRole("button")).toHaveLength(0);
    expect(within(supportRow).getByText(ROLE_TEXTS.noPermissions)).toBeInTheDocument();
    expect(within(memberRow).getByText(ROLE_TEXTS.defaultBadge)).toBeInTheDocument();
    expect(within(memberRow).getByRole("button", { name: ROLE_TEXTS.deleteLabel("Membro") })).toBeInTheDocument();
    expect(screen.queryByText("Visualizar Auditoria")).not.toBeInTheDocument();
  });

  it("celular: cards com Editar e o menu ⋯, contagens e Ver permissões", async () => {
    setWidth(360);
    respondWith({ data: ROWS });
    renderPage();
    await screen.findByText("Membro");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("1 membro")).toBeInTheDocument();
    expect(screen.getByText("2 permissões · 5 membros")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ROLE_TEXTS.actionsLabel("Membro") })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ROLE_TEXTS.deleteLabel("Membro") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ROLE_TEXTS.editLabel("Administrador") })).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: ROLE_TEXTS.showPermissions });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: ROLE_TEXTS.hidePermissions })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("O que a pessoa vê")).toBeInTheDocument();
    expect(screen.getByText("Visualizar Seu Ministério")).toBeInTheDocument();
  });

  it("só com Visualizar Funções, não há ações nem Nova função", async () => {
    setWidth(1280);
    auth.permissions = new Set(["view_roles"]);
    respondWith({ data: ROWS });
    renderPage();
    await screen.findByText("Apoio");
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("erro ao carregar: o aviso com Tentar de novo", async () => {
    setWidth(1280);
    // 42501 não é repetido pelo hook (as outras falhas repetem 3 vezes, com espera).
    respondWith({ error: { code: "42501", message: "permission denied" } }, { data: ROWS });
    renderPage();
    expect(await screen.findByText(ROLE_TEXTS.loadFailed)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: ROLE_TEXTS.tryAgain }));
    expect(await screen.findByText("Apoio")).toBeInTheDocument();
  });

  it("Nova função abre o formulário", async () => {
    setWidth(1280);
    respondWith({ data: ROWS });
    renderPage();
    await screen.findByText("Apoio");
    fireEvent.click(screen.getByRole("button", { name: ROLE_TEXTS.newRole }));
    expect(screen.getByRole("dialog", { name: ROLE_TEXTS.newRole })).toBeInTheDocument();
  });
});
