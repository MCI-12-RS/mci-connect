import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ChangePasswordRoute, ProtectedRoute, PublicRoute } from "./RouteGuards";

// O portão de rotas da troca obrigatória (E2.03, UX-03, P18).

const auth = vi.hoisted(() => ({
  session: { user: { id: "u1" } },
  loading: false,
  sessionEnded: false,
  mustChangePassword: true,
  passwordStatusLoaded: true,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<PublicRoute><p>login</p></PublicRoute>} />
        <Route path="/change-password" element={<ChangePasswordRoute><p>troca</p></ChangePasswordRoute>} />
        <Route path="/" element={<ProtectedRoute><p>dashboard</p></ProtectedRoute>} />
        <Route path="/members" element={<ProtectedRoute><p>membros</p></ProtectedRoute>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  auth.mustChangePassword = true;
  auth.passwordStatusLoaded = true;
});

describe("UX-03", () => {
  it.each(["/", "/members", "/login", "/change-password"])("com a marca, %s leva à troca, sem nada da tela", (path) => {
    renderAt(path);
    expect(screen.getByText("troca")).toBeInTheDocument();
    expect(screen.queryByText(/dashboard|membros|login/)).toBeNull();
  });

  it("sem a marca, /change-password leva a /", () => {
    auth.mustChangePassword = false;
    renderAt("/change-password");
    expect(screen.getByText("dashboard")).toBeInTheDocument();
  });

  it("enquanto a marca não foi lida, nenhuma tela protegida aparece", () => {
    auth.passwordStatusLoaded = false;
    auth.mustChangePassword = false;
    renderAt("/members");
    expect(screen.getByText("Carregando...")).toBeInTheDocument();
    expect(screen.queryByText("membros")).toBeNull();
  });
});
