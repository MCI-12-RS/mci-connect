import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";
import { isSessionEndedState } from "@/lib/auth/session";
import { ProtectedRoute } from "@/components/RouteGuards";
import { requestGate, requestSessionCheck } from "@/lib/auth/session-check";

// O cliente do Supabase falso: só o que o AuthContext usa.
type AuthListener = (event: string, session: { user: { id: string } } | null) => void;
type ReadResult = { data: unknown; error: unknown };

const mock = vi.hoisted(() => {
  const state: {
    listener: AuthListener | null;
    ownRead: () => Promise<ReadResult>;
    ownReads: number;
    passwordStatus: () => Promise<ReadResult>;
    rpcCalls: string[];
    memberReads: number;
  } = {
    listener: null,
    /** `my_password_status()` (E2.03): sem linha, sem a marca. */
    passwordStatus: (): Promise<ReadResult> => Promise.resolve({ data: null, error: null }),
    rpcCalls: [],
    memberReads: 0,
    /** Resposta da releitura (`select("id")`) do próprio cadastro. */
    ownRead: (): Promise<ReadResult> => Promise.resolve({ data: { id: "m1" }, error: null }),
    ownReads: 0,
  };
  const session = { user: { id: "u1" } };
  const signOut = vi.fn(async () => {
    state.listener?.("SIGNED_OUT", null);
    return { error: null };
  });
  const chain = (table: string) => {
    let columns = "";
    const builder = {
      select: (cols: string) => {
        columns = cols;
        return builder;
      },
      eq: () => builder,
      maybeSingle: () => {
        if (table === "members_view" && columns === "id") {
          state.ownReads += 1;
          return state.ownRead();
        }
        if (table === "members_view") {
          state.memberReads += 1;
          return Promise.resolve({ data: { id: "m1", role_id: null }, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      then: (resolve: (value: ReadResult) => unknown) => resolve({ data: [], error: null }),
    };
    return builder;
  };
  const supabase = {
    auth: {
      onAuthStateChange: (listener: AuthListener) => {
        state.listener = listener;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      getSession: () => Promise.resolve({ data: { session } }),
      signOut,
      setSession: vi.fn(),
    },
    from: (table: string) => chain(table),
    rpc: (name: string) => {
      state.rpcCalls.push(name);
      if (name === "my_password_status") return state.passwordStatus();
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { state, session, signOut, supabase };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: mock.supabase }));

// Os avisos (toasts) abertos: descartados só no fim forçado da sessão.
const toasts = vi.hoisted(() => ({ dismiss: vi.fn(), sonnerDismiss: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ dismiss: toasts.dismiss }));
vi.mock("sonner", () => ({ toast: { dismiss: toasts.sonnerDismiss } }));

function LoginProbe() {
  const location = useLocation();
  return <p>{isSessionEndedState(location.state) ? "login com aviso" : "login sem aviso"}</p>;
}

function Home() {
  const { signOut } = useAuth();
  return (
    <button type="button" onClick={() => void signOut()}>
      Sair
    </button>
  );
}

function renderApp() {
  const client = new QueryClient();
  const clear = vi.spyOn(client, "clear");
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginProbe />} />
            <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
            <Route path="/change-password" element={<p>troca obrigatória</p>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { clear };
}

describe("AuthContext: fim da sessão do membro excluído (E2.01, RN-14, DT-20)", () => {
  beforeEach(() => {
    mock.state.ownReads = 0;
    mock.state.ownRead = () => Promise.resolve({ data: { id: "m1" }, error: null });
    mock.signOut.mockClear();
    toasts.dismiss.mockClear();
    toasts.sonnerDismiss.mockClear();
  });

  it("sem linha e sem erro: encerra localmente e vai ao login com o aviso", async () => {
    const { clear } = renderApp();
    await screen.findByRole("button", { name: "Sair" });
    mock.state.ownRead = () => Promise.resolve({ data: null, error: null });

    await act(async () => requestSessionCheck());

    expect(await screen.findByText("login com aviso")).toBeInTheDocument();
    expect(mock.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(clear).toHaveBeenCalled();
    expect(toasts.dismiss).toHaveBeenCalledWith();
    expect(toasts.sonnerDismiss).toHaveBeenCalledWith();
  });

  it("queda de conexão não encerra a sessão", async () => {
    renderApp();
    await screen.findByRole("button", { name: "Sair" });
    mock.state.ownRead = () =>
      Promise.resolve({ data: null, error: { code: "", message: "TypeError: Failed to fetch" } });

    await act(async () => requestSessionCheck());

    await waitFor(() => expect(mock.state.ownReads).toBe(1));
    expect(mock.signOut).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
    expect(toasts.dismiss).not.toHaveBeenCalled();
  });

  it("várias recusas ao mesmo tempo geram uma releitura só", async () => {
    renderApp();
    await screen.findByRole("button", { name: "Sair" });
    let release: (value: ReadResult) => void = () => {};
    mock.state.ownRead = () => new Promise((resolve) => (release = resolve));

    act(() => {
      requestSessionCheck();
      requestSessionCheck();
      requestSessionCheck();
    });
    expect(mock.state.ownReads).toBe(1);
    await act(async () => release({ data: { id: "m1" }, error: null }));
    expect(mock.signOut).not.toHaveBeenCalled();
  });

  it("o SIGNED_OUT não pedido (renovação recusada) leva ao login com o aviso, sem releitura", async () => {
    renderApp();
    await screen.findByRole("button", { name: "Sair" });

    await act(async () => {
      mock.state.listener?.("SIGNED_OUT", null);
    });

    expect(await screen.findByText("login com aviso")).toBeInTheDocument();
    expect(mock.state.ownReads).toBe(0);
    expect(toasts.dismiss).toHaveBeenCalled();
    expect(toasts.sonnerDismiss).toHaveBeenCalled();
  });

  it("o Sair da pessoa vai ao login sem o aviso", async () => {
    renderApp();
    const button = await screen.findByRole("button", { name: "Sair" });

    await act(async () => {
      button.click();
    });

    expect(await screen.findByText("login sem aviso")).toBeInTheDocument();
    expect(mock.signOut).toHaveBeenCalledWith();
    expect(toasts.dismiss).not.toHaveBeenCalled();
    expect(toasts.sonnerDismiss).not.toHaveBeenCalled();
  });

  it("a volta do foco relê o cadastro, no máximo uma vez por intervalo", async () => {
    renderApp();
    await screen.findByRole("button", { name: "Sair" });

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(mock.state.ownReads).toBe(1);
  });
});

describe("AuthContext: a marca de troca obrigatória (E2.03, RN-09, RN-16, AQ-3)", () => {
  beforeEach(() => {
    mock.state.ownRead = () => Promise.resolve({ data: { id: "m1" }, error: null });
    mock.state.passwordStatus = () => Promise.resolve({ data: null, error: null });
    mock.state.rpcCalls = [];
    mock.state.memberReads = 0;
    mock.signOut.mockClear();
  });

  it("com a marca na abertura, leva à troca e não lê o acesso nem o próprio cadastro (RN-09 b)", async () => {
    mock.state.passwordStatus = () => Promise.resolve({ data: [{ must_change_password: true }], error: null });
    renderApp();
    expect(await screen.findByText("troca obrigatória")).toBeInTheDocument();
    expect(mock.state.rpcCalls).toContain("my_password_status");
    expect(mock.state.rpcCalls).not.toContain("my_access");
    expect(mock.state.memberReads).toBe(0);
  });

  it("a sessão apagada (session_ended) vai ao login com o aviso (RN-16)", async () => {
    mock.state.passwordStatus = () =>
      Promise.resolve({
        data: null,
        error: { code: "42501", message: "x", details: JSON.stringify({ code: "session_ended" }), hint: "app_error" },
      });
    renderApp();
    expect(await screen.findByText("login com aviso")).toBeInTheDocument();
    expect(mock.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("o código password_change_required de qualquer chamada leva à troca, sem mensagem (RN-09 c)", async () => {
    renderApp();
    await screen.findByRole("button", { name: "Sair" });
    await act(async () => requestGate("password_change_required"));
    expect(await screen.findByText("troca obrigatória")).toBeInTheDocument();
    expect(mock.signOut).not.toHaveBeenCalled();
  });

  it("sem a marca, a leitura com erro de rede não prende a tela", async () => {
    mock.state.passwordStatus = () => Promise.resolve({ data: null, error: { code: "", message: "TypeError: Failed to fetch" } });
    renderApp();
    expect(await screen.findByRole("button", { name: "Sair" })).toBeInTheDocument();
  });
});
