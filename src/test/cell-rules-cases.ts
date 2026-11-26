// A tabela única de casos das regras do cadastro de célula (E2.08, AQ-4,
// DT-17), lida pelos testes de `src/lib/cells/*`. É a mesma do pgTAP gerado
// (`e208_02_cases.test.sql`).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type DbOutcome = { stored: string } | { code: string } | { sqlstate: string };

export interface CellRulesCases {
  weekdays: string[];
  weekday_options: Array<{ label: string; value: string }>;
  types: string[];
  default_type: string;
  meeting_day: Array<{ id: string; input: string | null; db: DbOutcome }>;
  type: Array<{ id: string; op: "insert" | "update"; omit: boolean; input: string | null; db: DbOutcome }>;
  meeting_time: Array<{
    id: string;
    input: string | null;
    typing: string;
    blur: string;
    ui_valid: boolean;
    db: DbOutcome | null;
  }>;
}

const casesPath = resolve(__dirname, "../../supabase/tests/fixtures/cell-rules-cases.json");

export const cellRulesCases: CellRulesCases = JSON.parse(readFileSync(casesPath, "utf8"));
