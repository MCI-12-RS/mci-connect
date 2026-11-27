import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemberFilters } from "./MemberFilters";
import { EMPTY_MEMBER_FILTERS } from "@/lib/members/filters";
import { MEMBER_FILTER_LABELS, MEMBER_FILTER_TEXTS } from "@/lib/members/filter-texts";

function renderPanel(onChange = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemberFilters
        variant="panel"
        value={EMPTY_MEMBER_FILTERS}
        onChange={onChange}
        leaders={[]}
        onLeadersPicked={vi.fn()}
        unavailableCount={0}
        noResultsLabel=""
      />
    </QueryClientProvider>,
  );
  return { onChange, from: screen.getByLabelText(MEMBER_FILTER_LABELS.from) };
}

describe("MemberFilters, datas no painel (E2.07, P54)", () => {
  it("aplica só a data completa, com o ano de 4 dígitos, e mantém no campo o que ainda está a meio", () => {
    const { onChange, from } = renderPanel();
    fireEvent.change(from, { target: { value: "0202-11-22" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(from).toHaveValue("0202-11-22");
    fireEvent.change(from, { target: { value: "2026-11-22" } });
    expect(onChange).toHaveBeenLastCalledWith({ from: "2026-11-22" });
    fireEvent.change(from, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ from: null });
  });

  it("ao sair do campo com o ano incompleto, mostra a data inválida", () => {
    const { from } = renderPanel();
    fireEvent.change(from, { target: { value: "0202-11-22" } });
    fireEvent.blur(from);
    expect(screen.getByText(MEMBER_FILTER_TEXTS.invalidDate)).toBeInTheDocument();
  });
});
