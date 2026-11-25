import "@testing-library/jest-dom";

// `matchMedia` com `min-width` e `max-width` medidos contra `window.innerWidth`:
// os testes trocam a largura com `innerWidth` (P45, `use-min-width`). As demais
// consultas não casam.
function mediaMatches(query: string): boolean {
  const min = /\(min-width:\s*(\d+)px\)/.exec(query);
  if (min) return window.innerWidth >= Number(min[1]);
  const max = /\(max-width:\s*(\d+)px\)/.exec(query);
  if (max) return window.innerWidth <= Number(max[1]);
  return false;
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: mediaMatches(query),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// O jsdom não implementa a rolagem até um elemento (o seletor traz o menu para a vista).
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// O jsdom não tem ResizeObserver, que o Radix usa para medir o Switch, o
// RadioGroup e o Checkbox (o formulário de membro tem os três).
if (!("ResizeObserver" in window)) {
  class NoopResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, "ResizeObserver", { writable: true, configurable: true, value: NoopResizeObserver });
}
