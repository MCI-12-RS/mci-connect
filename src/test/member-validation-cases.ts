// A tabela única de casos das regras do cadastro de membro (E2.04, AQ-2,
// DT-17), lida pelos testes de `src/lib/members/*`. É a mesma do pgTAP
// gerado (`e204_01_functions_cases.test.sql`).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface MemberValidationCases {
  placeholderEmailDomains: string[];
  generationDomain: string;
  name: Array<{ id: string; input: string | null; normalized: string | null; valid: boolean }>;
  email: Array<{ id: string; input: string | null; normalized: string | null; valid: boolean; placeholder: boolean }>;
  mobile: Array<{ id: string; input: string | null; normalized: string | null; matchKey: string | null }>;
  cpf: Array<{ id: string; input: string | null; digits: string | null; valid: boolean }>;
  birthDate: Array<{ id: string; today: string; birth: string | null; problem: string | null }>;
  age: Array<{ id: string; today: string; birth: string; text: string }>;
  identifier: Array<{ id: string; email: string | null; mobile: string | null; cpf: string | null; hasIdentifier: boolean }>;
}

const casesPath = resolve(__dirname, "../../supabase/tests/fixtures/member-validation-cases.json");

export const memberValidationCases: MemberValidationCases = JSON.parse(readFileSync(casesPath, "utf8"));
