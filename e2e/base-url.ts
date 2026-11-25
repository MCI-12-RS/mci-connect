// URL do app nos testes E2E. Padrão: o `npm run dev` (porta 8080).
// Para rodar uma segunda pista em paralelo (outro worktree e outra stack local),
// defina E2E_PORT (ex.: 8180); E2E_BASE_URL sobrescreve a URL inteira.
export const E2E_PORT = Number(process.env.E2E_PORT ?? 8080);
export const E2E_BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${E2E_PORT}`;
