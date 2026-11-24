import { describe, it, expect } from "vitest";
import { isUuid } from "./ids";

describe("isUuid", () => {
  it("aceita a forma canônica, de qualquer versão, em maiúsculas ou minúsculas", () => {
    expect(isUuid("3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b")).toBe(true);
    expect(isUuid("3F2B8C1E-9A4D-4E6F-8B7A-1C2D3E4F5A6B")).toBe(true);
    expect(isUuid("00000000-0000-0000-0000-000000000000")).toBe(true);
    // Sem versão nem variante, como os ids da massa de testes.
    expect(isUuid("e2e201e0-0003-0000-0000-000000000001")).toBe(true);
  });

  it("recusa o que não é UUID", () => {
    expect(isUuid("")).toBe(false);
    expect(isUuid("abc")).toBe(false);
    expect(isUuid("r2")).toBe(false);
    expect(isUuid("3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6")).toBe(false);
    expect(isUuid("3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6bb")).toBe(false);
    expect(isUuid("3f2b8c1g-9a4d-4e6f-8b7a-1c2d3e4f5a6b")).toBe(false);
    expect(isUuid(" 3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b")).toBe(false);
    expect(isUuid("3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b\n")).toBe(false);
    expect(isUuid("{3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b}")).toBe(false);
    expect(isUuid("3f2b8c1e9a4d4e6f8b7a1c2d3e4f5a6b")).toBe(false);
    expect(isUuid("3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b' or '1'='1")).toBe(false);
  });
});
