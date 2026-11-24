import { describe, it, expect } from "vitest";
import { CELL_ROLES, formatCellRoles, isCellRole } from "./roles";

describe("isCellRole", () => {
  it.each(CELL_ROLES)("%s é um papel", (role) => {
    expect(isCellRole(role)).toBe(true);
  });

  it.each(["Líder", "owner", "", null, 1])("%j não é um papel", (value) => {
    expect(isCellRole(value)).toBe(false);
  });
});

describe("formatCellRoles", () => {
  it("um papel: o rótulo", () => {
    expect(formatCellRoles(["leader"])).toBe("Líder");
    expect(formatCellRoles(["timothy"])).toBe("Timóteo");
    expect(formatCellRoles(["host"])).toBe("Anfitrião");
  });

  it("dois ou três papéis: juntos, o primeiro com maiúscula", () => {
    expect(formatCellRoles(["leader", "host"])).toBe("Líder e anfitrião");
    expect(formatCellRoles(["leader", "timothy", "host"])).toBe("Líder, timóteo e anfitrião");
  });

  it("nenhum papel: vazio", () => {
    expect(formatCellRoles([])).toBe("");
  });
});
