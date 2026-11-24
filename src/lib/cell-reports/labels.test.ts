import { describe, it, expect } from "vitest";
import { formatReportDate } from "./labels";

describe("formatReportDate", () => {
  it("dd/MM/aaaa, sem mudar o dia por causa do fuso", () => {
    expect(formatReportDate("2026-11-19")).toBe("19/11/2026");
    expect(formatReportDate("2026-01-01")).toBe("01/01/2026");
  });
});
