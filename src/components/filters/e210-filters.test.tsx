import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { GroupedMultiChoiceFilter } from "./GroupedMultiChoiceFilter";
import { RecordFilterChip } from "./RecordFilterChip";
import { PersonMultiFilter } from "./PersonMultiFilter";
import type { OptionsPagination, SelectSearch } from "@/hooks/use-paginated-select";
import { REPORT_STATUS_FILTER, reportStatusFilterLabel, type ReportStatusFilterOption } from "@/lib/cells/report-status";
import { CELL_FILTER_TEXTS } from "@/lib/cells/filter-texts";
import { CELL_REPORT_FILTER_TEXTS } from "@/lib/cell-reports/texts";
import type { SelectOption } from "@/lib/selectors";

// Componentes de filtro do E2.10 (tarefa 6): P85 (múltipla escolha em subgrupos), P84 (filtro por
// um registro de outra tela) e o `PersonMultiFilter` com outra fonte de opções (UXD-2).

function Grouped({ variant, initial = [] }: { variant: "checkboxes" | "popover"; initial?: ReportStatusFilterOption[] }) {
  const [values, setValues] = useState<ReportStatusFilterOption[]>(initial);
  return (
    <>
      <GroupedMultiChoiceFilter
        legend={REPORT_STATUS_FILTER.legend}
        groups={REPORT_STATUS_FILTER.groups}
        values={values}
        onChange={setValues}
        variant={variant}
        hint={REPORT_STATUS_FILTER.hint}
        fullLabel={reportStatusFilterLabel}
        allLabel={REPORT_STATUS_FILTER.all}
      />
      <output data-testid="values">{values.join(",")}</output>
    </>
  );
}

describe("GroupedMultiChoiceFilter (P85, UX-10, UX-28)", () => {
  it("fieldset dentro de fieldset, com as legendas dos subgrupos e a dica no grupo de fora", () => {
    render(<Grouped variant="checkboxes" />);
    const outer = screen.getByRole("group", { name: "Situação do relatório" });
    expect(outer).toHaveAccessibleDescription("Células inativas não têm situação do relatório.");
    const week = within(outer).getByRole("group", { name: "Nesta semana" });
    const previous = within(outer).getByRole("group", { name: "Sem relatório nas semanas anteriores" });
    expect(within(week).getAllByRole("checkbox").map((box) => box.closest("label")?.textContent)).toEqual([
      "Enviado",
      "Ainda não ocorreu",
      "Pendente",
      "Conta a partir da próxima semana",
    ]);
    expect(within(previous).getAllByRole("checkbox").map((box) => box.closest("label")?.textContent)).toEqual([
      "Na semana passada",
      "Nas 2 semanas anteriores",
      "Nas 3 semanas anteriores",
      "Nas 4 ou mais semanas anteriores",
    ]);
  });

  it("marcar opções dos dois subgrupos guarda os valores na ordem das opções", () => {
    render(<Grouped variant="checkboxes" />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Na semana passada" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Pendente" }));
    expect(screen.getByTestId("values")).toHaveTextContent("pending,missed_1");
    fireEvent.click(screen.getByRole("checkbox", { name: "Pendente" }));
    expect(screen.getByTestId("values")).toHaveTextContent(/^missed_1$/);
  });

  it("no computador: o botão mostra 'Todas' e depois os textos inteiros", () => {
    const { unmount } = render(<Grouped variant="popover" />);
    expect(screen.getByRole("button", { name: /Situação do relatório/ })).toHaveTextContent("Todas");
    unmount();
    render(<Grouped variant="popover" initial={["pending", "missed_1"]} />);
    const button = screen.getByRole("button", { name: /Situação do relatório/ });
    expect(button).toHaveTextContent("Pendente, Sem relatório na semana passada");
  });
});

describe("RecordFilterChip (P84, UX-25, UX-30)", () => {
  const texts = CELL_REPORT_FILTER_TEXTS.chip;
  it.each([
    [{ kind: "loading" } as const, "Célula: carregando…"],
    [{ kind: "failed" } as const, "Célula: não carregada"],
    [{ kind: "ready", text: "Célula de André Souza · Quarta · 20:00" } as const, "Célula de André Souza · Quarta · 20:00"],
  ])("%o mostra o texto, sem dica", (state, text) => {
    render(<RecordFilterChip state={state} texts={texts} onRemove={vi.fn()} />);
    const chip = screen.getByRole("button", { name: `Remover filtro ${text}` });
    expect(chip).toHaveTextContent(text);
    expect(chip).toHaveClass("min-h-9");
    expect(screen.queryByText(texts.unavailableHint)).toBeNull();
  });

  it("indisponível: o chip sem nome e sem id, e a dica com o ícone", () => {
    const remove = vi.fn();
    render(<RecordFilterChip state={{ kind: "unavailable" }} texts={texts} onRemove={remove} trailing={<button>Limpar filtros</button>} />);
    fireEvent.click(screen.getByRole("button", { name: "Remover filtro Célula indisponível" }));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Esta célula não está disponível para você.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Limpar filtros" })).toBeInTheDocument();
  });
});

/** Uma fonte simulada: o que o seletor pede e as opções que ele mostra. */
function fakeSource(options: SelectOption[]) {
  const searches: string[] = [];
  const useOptions = (search: SelectSearch): OptionsPagination => {
    searches.push(search.term);
    return {
      options,
      isLoading: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      loadMore: () => undefined,
      retry: () => undefined,
    };
  };
  return { useOptions, searches };
}

describe("PersonMultiFilter com a fonte de Células (UXD-2, UX-08)", () => {
  const leaderOptions: SelectOption[] = [
    { value: "a", label: "André Souza", suffix: { text: "(144)", spoken: "nível 144" } },
    { value: "p", label: "Paula Alves", suffix: { text: "(G12)", spoken: "G12" } },
  ];

  function Harness({ initial = [] as SelectOption[], unavailable = 0 }) {
    const [value, setValue] = useState<SelectOption[]>(initial);
    const source = fakeSource(leaderOptions);
    return (
      <PersonMultiFilter
        texts={CELL_FILTER_TEXTS.leaders}
        value={value}
        onChange={setValue}
        unavailableCount={unavailable}
        noResultsLabel={CELL_FILTER_TEXTS.leaders.noResults}
        max={10}
        useOptions={source.useOptions}
      />
    );
  }

  it("as opções vêm da fonte, com o nível visível e lido como 'nível'", () => {
    render(<Harness />);
    const input = screen.getByRole("combobox", { name: "Líder" });
    const described = (input.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent);
    expect(described).toContain("Mostra as células lideradas pelas pessoas escolhidas.");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const option = screen.getByRole("option", { name: /André Souza/ });
    expect(option).toHaveTextContent("André Souza (144), nível 144");
    expect(within(option).getByText("(144)")).toHaveAttribute("aria-hidden", "true");
  });

  it("com 10 pessoas: 'Escolha até 10 pessoas.' com role=status", () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ value: `id${i}`, label: `Pessoa ${i}` }));
    render(<Harness initial={ten} />);
    expect(screen.getAllByRole("status").some((el) => el.textContent === "Escolha até 10 pessoas.")).toBe(true);
  });

  it("pessoa indisponível: o rótulo e a dica, sem id no DOM (UX-09)", () => {
    render(<Harness initial={[{ value: "e2e210f1-0000-0000-0000-000000000099", label: "Pessoa indisponível" }]} unavailable={1} />);
    expect(screen.getByText("Pessoa indisponível")).toBeInTheDocument();
    expect(screen.getByText("Esta pessoa não está disponível para você.")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain("e2e210f1-0000-0000-0000-000000000099");
  });
});
