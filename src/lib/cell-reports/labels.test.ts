import { describe, it, expect } from "vitest";
import { formatOffering, formatReportDate } from "./labels";

describe("formatReportDate", () => {
  it("dd/MM/aaaa, sem mudar o dia por causa do fuso", () => {
    expect(formatReportDate("2026-11-19")).toBe("19/11/2026");
    expect(formatReportDate("2026-01-01")).toBe("01/01/2026");
  });
});

describe("formatOffering (E2.10, RN-17, PO-UX-10)", () => {
  it("em reais, com zero como R$ 0,00", () => {
    expect(formatOffering(50).replace(/\s/g, " ")).toBe("R$ 50,00");
    expect(formatOffering(0).replace(/\s/g, " ")).toBe("R$ 0,00");
    expect(formatOffering(1234.5).replace(/\s/g, " ")).toBe("R$ 1.234,50");
    expect(formatOffering("20").replace(/\s/g, " ")).toBe("R$ 20,00");
  });

  it("sem valor registrado: Não informada, nunca R$ 0,00", () => {
    expect(formatOffering(null)).toBe("Não informada");
    expect(formatOffering(undefined)).toBe("Não informada");
    expect(formatOffering("")).toBe("Não informada");
    expect(formatOffering("abc")).toBe("Não informada");
  });
});
