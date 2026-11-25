import { describe, it, expect } from "vitest";
import type { SelectOption } from "@/lib/selectors";
import {
  LOAD_MORE_OPTION,
  RETRY_OPTION,
  SELECT_ARIA_MESSAGES,
  describedByWithError,
  loadFailedLabel,
  noResultsMessage,
  resultsMessage,
} from "./select-a11y";

// Anúncios dos seletores paginados para o leitor de tela (E1.08, RN-07).

const options: SelectOption[] = Array.from({ length: 20 }, (_, i) => ({ value: `m${i}`, label: `Membro ${i}` }));

/** O anúncio do foco numa opção do menu, como num aparelho da Apple (VoiceOver). */
function focusMessage(focused: SelectOption, list: readonly SelectOption[], isSelected = false) {
  const onFocus = SELECT_ARIA_MESSAGES.onFocus;
  if (!onFocus) throw new Error("onFocus não definido");
  return onFocus({
    context: "menu",
    focused,
    options: list,
    label: focused.label,
    isDisabled: false,
    isSelected,
    selectValue: [],
    isAppleDevice: true,
  });
}

describe("resultsMessage", () => {
  it.each([
    [0, "0 resultados disponíveis"],
    [1, "1 resultado disponível"],
    [20, "20 resultados disponíveis"],
  ])("%i opções → %s", (count, message) => {
    expect(resultsMessage(count)).toBe(message);
  });

  it("com falha e nada carregado, diz que não carregou (e não 0 resultados)", () => {
    expect(resultsMessage(0, { failed: true })).toBe("Não foi possível carregar as opções");
  });

  it("com falha na página seguinte, diz que não carregou mais e o que já está no menu", () => {
    expect(resultsMessage(20, { failed: true })).toBe("Não foi possível carregar mais opções. 20 resultados disponíveis");
  });
});

describe("noResultsMessage", () => {
  it("sem busca", () => {
    expect(noResultsMessage("Nenhum membro encontrado", "")).toBe("Nenhum membro encontrado.");
  });

  it("com a busca", () => {
    expect(noResultsMessage("Nenhuma célula encontrada", "rua a")).toBe('Nenhuma célula encontrada para a busca "rua a".');
  });

  it("o texto que já termina em ponto não ganha outro (E2.02, P11)", () => {
    expect(noResultsMessage("Nenhum membro do seu ministério encontrado.", "")).toBe(
      "Nenhum membro do seu ministério encontrado.",
    );
    expect(noResultsMessage("Nenhum membro do seu ministério encontrado.", "ana")).toBe(
      'Nenhum membro do seu ministério encontrado para a busca "ana".',
    );
  });
});

describe("SELECT_ARIA_MESSAGES.onFilter", () => {
  it("junta o total e a busca numa frase", () => {
    expect(SELECT_ARIA_MESSAGES.onFilter?.({ inputValue: "ma", resultsMessage: "2 resultados disponíveis" })).toBe(
      '2 resultados disponíveis para a busca "ma".',
    );
  });

  it("a falha também lê bem com a busca", () => {
    expect(
      SELECT_ARIA_MESSAGES.onFilter?.({ inputValue: "ma", resultsMessage: resultsMessage(0, { failed: true }) }),
    ).toBe('Não foi possível carregar as opções para a busca "ma".');
  });
});

describe("SELECT_ARIA_MESSAGES.onFocus (posição no menu)", () => {
  it("a posição desconta o item Carregar mais", () => {
    expect(focusMessage(options[1], [...options, LOAD_MORE_OPTION])).toBe("Membro 1, 2 de 20.");
    expect(focusMessage(options[19], [...options, LOAD_MORE_OPTION])).toBe("Membro 19, 20 de 20.");
  });

  it("a posição desconta o item Tentar novamente", () => {
    expect(focusMessage(options[0], [...options, RETRY_OPTION], true)).toBe("Membro 0, selecionada, 1 de 20.");
  });

  it("o foco no item de ação diz só o rótulo, sem posição", () => {
    expect(focusMessage(LOAD_MORE_OPTION, [...options, LOAD_MORE_OPTION])).toBe("Carregar mais.");
  });

  it("o foco em Tentar novamente diz a mesma falha que o texto do item", () => {
    expect(focusMessage(RETRY_OPTION, [RETRY_OPTION])).toBe("Não foi possível carregar as opções. Tentar novamente.");
    expect(focusMessage(RETRY_OPTION, [...options, RETRY_OPTION])).toBe(
      "Não foi possível carregar mais opções. Tentar novamente.",
    );
  });
});

describe("loadFailedLabel", () => {
  it("sem opções no menu, nada carregou; com opções, faltou a página seguinte", () => {
    expect(loadFailedLabel(false)).toBe("Não foi possível carregar as opções");
    expect(loadFailedLabel(true)).toBe("Não foi possível carregar mais opções");
  });
});

describe("describedByWithError", () => {
  it("com erro, soma o id da mensagem ao que o react-select já pôs", () => {
    expect(describedByWithError("rs-placeholder", "cell-message")).toBe("rs-placeholder cell-message");
  });

  it("sem erro, fica só o do react-select", () => {
    expect(describedByWithError("rs-placeholder", undefined)).toBe("rs-placeholder");
  });

  it("só o erro, ou nada", () => {
    expect(describedByWithError(undefined, "cell-message")).toBe("cell-message");
    expect(describedByWithError(undefined, undefined)).toBeUndefined();
  });

  it("o texto que a tela liga ao campo entra entre o do react-select e o erro", () => {
    expect(describedByWithError("rs-placeholder", "cell-message", "kept-line")).toBe("rs-placeholder kept-line cell-message");
    expect(describedByWithError(undefined, undefined, "kept-line")).toBe("kept-line");
  });
});
