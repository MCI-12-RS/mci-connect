import type { ReactNode } from "react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { resetFakeSupabase, respondWith } from "@/test/fake-supabase";
import Events from "./Events";

// Auditoria (E2.01, RN-19): a data e a hora de cada evento ficam no horário de
// Brasília mesmo com o navegador em outro fuso, como nas listas de excluídos
// (UX-15), no formato "dd/MM/aaaa, HH:mm" da tela. O fuso do processo vira o
// de Tóquio (UTC+9) antes de carregar os módulos (os formatadores de data são
// criados na carga): o instante abaixo cai em outro dia e outra hora lá. Esta
// máquina já está em Brasília, então sem isso o teste passaria mesmo sem o
// fuso fixo no código.
const originalTz = vi.hoisted(() => {
  const tz = process.env.TZ;
  process.env.TZ = "Asia/Tokyo";
  return tz;
});

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

// 11/11/2026 02:30 UTC: 23:30 de 10/11 em Brasília, 11:30 de 11/11 em Tóquio.
const NIGHT_UTC = "2026-11-11T02:30:00Z";

const restoreCell = {
  id: "e1",
  occurred_at: NIGHT_UTC,
  actor_user_id: "u-ad",
  actor_label: "Elisa Martins",
  action: "restore",
  entity: "cell",
  entity_id: "cell-1",
  entity_label: "célula de Rui Prado",
  description: "Restaurou a célula de Rui Prado",
  changed_fields: null,
  metadata: {},
  success: true,
  error_reason: null,
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

describe("Auditoria: data e hora no horário de Brasília, com o navegador em Tóquio", () => {
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  beforeEach(() => resetFakeSupabase());

  it("Dado o fuso de Tóquio no navegador, então o relógio e o Intl locais estão mesmo em outro dia (sanidade do teste)", () => {
    const local = new Date(NIGHT_UTC);
    expect([local.getDate(), local.getHours(), local.getMinutes()]).toEqual([11, 11, 30]);
    expect(new Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("Asia/Tokyo");
  });

  it("Dado um evento às 02:30 UTC, então a linha mostra '10/11/2026 23:30' e o detalhe '10/11/2026 às 23:30' (UX-02)", async () => {
    respondWith({ data: [restoreCell] });
    renderPage();

    const row = (await screen.findByText("Restaurou a célula de Rui Prado")).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row).getByText("10/11/2026 23:30")).toBeInTheDocument();

    fireEvent.click(row);
    const sheet = await screen.findByRole("dialog", { name: "Detalhes do evento" });
    expect(within(sheet).getByText("10/11/2026 às 23:30")).toBeInTheDocument();
  });
});
