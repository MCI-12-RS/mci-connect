import type { ReactNode } from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigationType } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fakeRpcs, resetFakeSupabase, respondToRpc, type FakeResponse } from "@/test/fake-supabase";
import type { MemberRow } from "@/lib/members/fields";
import Members from "./Members";

// Corrida e histórico da lista de Membros com filtros (E2.07, RN-02, RN-14, UX-11): a resposta de uma
// consulta antiga que chega depois nunca substitui a da última escolha, e a limpeza da URL e os chips
// trocam a entrada do histórico (REPLACE), sem criar outra.

vi.mock("@/integrations/supabase/client", async () => {
  const { fakeSupabase } = await import("@/test/fake-supabase");
  return { supabase: fakeSupabase };
});

vi.mock("@/components/AppLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u-self" },
    access: { sees_whole_church: true, member_id: "rita", can_create_member: false },
    hasPermission: () => false,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

function row(overrides: Partial<MemberRow>): MemberRow {
  return {
    id: "x",
    name: "Sem Nome",
    gender: "M",
    birth_date: null,
    instagram: null,
    avatar_url: null,
    notes: null,
    neighborhood: null,
    city: null,
    state: null,
    is_pastor: false,
    has_leadership: true,
    leader_id: "l1",
    leader_name: "Gil Souza",
    spouse_id: null,
    spouse_name: null,
    is_baptized: false,
    baptism_date: null,
    is_active: true,
    g12_level: 2,
    g12_name: null,
    total_disciples: 0,
    total_cells: 0,
    auth_user_id: null,
    sensitive_visible: false,
    email: null,
    cpf: null,
    mobile_whatsapp: null,
    phone: null,
    street: null,
    number: null,
    complement: null,
    zip_code: null,
    ...overrides,
  };
}


function Probe() {
  const location = useLocation();
  const type = useNavigationType();
  return (
    <>
      <output data-testid="location">{location.search}</output>
      <output data-testid="nav">{type}</output>
    </>
  );
}

function renderMembers(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Members />
        <Probe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const originalWidth = window.innerWidth;
const setWidth = (width: number) => Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
const atrasado = row({ id: "atrasado", name: "Resposta Atrasada" });
const caio = row({ id: "caio", name: "Caio Lima" });

beforeEach(() => {
  resetFakeSupabase();
  setWidth(360);
});
afterEach(() => setWidth(originalWidth));

describe("RN-02: corrida entre filtros", () => {
  it("a resposta antiga que chega depois da nova não a substitui (lista e total)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    // 1ª consulta (Situação: Ativo) fica presa; a 2ª (sem filtro) responde logo.
    respondToRpc("members_list", { data: [atrasado], until: gate }, { data: [caio] });
    respondToRpc("members_list_count", { data: 99, until: gate }, { data: 1 });
    renderMembers("/members?status=active");
    await waitFor(() => expect(fakeRpcs().filter((call) => call.fn === "members_list")).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Remover filtro Situação: Ativo" }));
    expect(await screen.findByText("Caio Lima")).toBeInTheDocument();
    expect(await screen.findByText("1 membro", { selector: "[role='status']" })).toBeInTheDocument();
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText("Resposta Atrasada")).not.toBeInTheDocument();
    expect(screen.getByText("Caio Lima")).toBeInTheDocument();
    expect(screen.queryByText("99 membros", { selector: "[role='status']" })).not.toBeInTheDocument();
    expect(screen.getByTestId("location").textContent).toBe("");
  });
});

describe("UX-11, RN-14: histórico", () => {
  it("a URL inválida é limpa com REPLACE, sem nova entrada", async () => {
    respondToRpc("members_list", { data: [caio] });
    respondToRpc("members_list_count", { data: 1 });
    renderMembers("/members?level=abc&baptized=yes");
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("?baptized=yes"));
    expect(screen.getByTestId("nav").textContent).toBe("REPLACE");
  });

  it("tirar um filtro pelo chip também troca a entrada (REPLACE)", async () => {
    respondToRpc("members_list", { data: [caio] }, { data: [caio] });
    respondToRpc("members_list_count", { data: 1 }, { data: 1 });
    renderMembers("/members?status=active");
    await screen.findByText("Caio Lima");
    fireEvent.click(screen.getByRole("button", { name: "Remover filtro Situação: Ativo" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe(""));
    expect(screen.getByTestId("nav").textContent).toBe("REPLACE");
  });
});
