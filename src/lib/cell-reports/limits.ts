// Os tetos do relatório (E2.11, DA-4, DA-5; RN-10, RN-12, RN-13). Os mesmos
// valores de `private.report_limits()` e da tabela de casos
// (`supabase/tests/fixtures/report-rules-cases.json`); o `limits.test.ts`
// quebra se divergirem. Nenhum outro arquivo do front repete estes números.

export const REPORT_LIMITS = {
  theme: 300,
  reason: 2000,
  observations: 4000,
  visitorName: 150,
  visitors: 1000,
  participants: 1000,
  /** Em reais. */
  offeringMax: 999_999.99,
} as const;
