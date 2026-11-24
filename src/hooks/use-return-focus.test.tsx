import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useReturnFocus } from "./use-return-focus";

// Foco ao fechar um diálogo das listas (E2.01, Acessibilidade; WCAG 2.4.3):
// volta a quem abriu ou, se ele saiu da página, ao campo de busca.

let search: HTMLInputElement;
let opener: HTMLButtonElement;
let other: HTMLButtonElement;

/** O `onCloseAutoFocus` do Radix: um evento que pode ter o padrão cancelado. */
const closeEvent = () => new Event("focusScope.autoFocusOnUnmount", { cancelable: true });

function renderReturnFocus() {
  const searchRef = { current: search };
  return renderHook(({ listData }) => useReturnFocus(searchRef, listData), { initialProps: { listData: 1 } });
}

describe("useReturnFocus", () => {
  beforeEach(() => {
    search = document.createElement("input");
    opener = document.createElement("button");
    other = document.createElement("button");
    document.body.append(search, opener, other);
  });

  afterEach(() => document.body.replaceChildren());

  it("Ao fechar, o foco vai para quem abriu, e o padrão do Radix (o body) é cancelado", () => {
    const { result } = renderReturnFocus();
    result.current.setOpener(opener);
    const event = closeEvent();

    act(() => result.current.onCloseAutoFocus(event));

    expect(event.defaultPrevented).toBe(true);
    expect(opener).toHaveFocus();
  });

  it("Se quem abriu já saiu da página, o foco vai para a busca", () => {
    const { result } = renderReturnFocus();
    result.current.setOpener(opener);
    opener.remove();

    act(() => result.current.onCloseAutoFocus(closeEvent()));

    expect(search).toHaveFocus();
  });

  it("Sem quem abriu, o foco vai para a busca", () => {
    const { result } = renderReturnFocus();

    act(() => result.current.onCloseAutoFocus(closeEvent()));

    expect(search).toHaveFocus();
  });

  it("Se a lista recarrega sem o item depois de o foco voltar, o foco passa para a busca", () => {
    const { result, rerender } = renderReturnFocus();
    result.current.setOpener(opener);
    act(() => result.current.onCloseAutoFocus(closeEvent()));
    expect(opener).toHaveFocus();

    // A linha some: o navegador larga o foco no body.
    opener.remove();
    expect(document.activeElement).toBe(document.body);
    rerender({ listData: 2 });

    expect(search).toHaveFocus();
  });

  it("Se a lista recarrega com o item, o foco fica nele", () => {
    const { result, rerender } = renderReturnFocus();
    result.current.setOpener(opener);
    act(() => result.current.onCloseAutoFocus(closeEvent()));

    rerender({ listData: 2 });

    expect(opener).toHaveFocus();
  });

  it("Se a pessoa já levou o foco para outro lugar, a lista recarregada sem o item não o tira de lá", () => {
    const { result, rerender } = renderReturnFocus();
    result.current.setOpener(opener);
    act(() => result.current.onCloseAutoFocus(closeEvent()));

    other.focus();
    opener.remove();
    rerender({ listData: 2 });

    expect(other).toHaveFocus();
  });
});
