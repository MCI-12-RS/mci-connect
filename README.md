# MCI Connect

Sistema de gestão da Igreja MCI (Missão Carismática Internacional do RS, visão G12). Cuida dos membros, da hierarquia de discipulado (ministérios), das células e dos relatórios de célula.

Em produção: [connect.mci12rs.com.br](https://connect.mci12rs.com.br)

## Stack

- **Front:** React 18 + TypeScript, Vite, Tailwind, shadcn/ui, TanStack Query, react-hook-form + zod e React Router.
- **Back-end:** Supabase (Postgres com RLS, Auth e Edge Functions em Deno). As regras de negócio ficam no banco: constraints, políticas, triggers e funções.
- **Hospedagem:** Vercel.

## Rodando localmente

Requisitos: Node.js 18+.

```bash
npm install
npm run dev        # http://localhost:8080
```

O `.env` aponta para o projeto Supabase de produção usando a chave pública (publishable). Ela é pública por natureza e não dá acesso além do que o RLS permite.

| Comando | O que faz |
|---|---|
| `npm run build` | Build de produção |
| `npm run lint` | ESLint |
| `npm test` | Testes unitários (Vitest) |
| `npm run test:e2e` | Testes de comportamento (Playwright). Na primeira vez, rode `npx playwright install chromium` |

## Banco de dados (Supabase)

- **Migrations:** ficam em `supabase/migrations/`.
  - Nunca edite uma migration que já foi aplicada; crie uma nova.
  - Para testar localmente, é preciso o Docker: `npx supabase start` (aplica todas as migrations), depois `npx supabase db reset`.
- **Tipos:** depois de mudar o schema, regenere `src/integrations/supabase/types.ts` com `npx supabase gen types typescript`.
- **Edge Functions:** ficam em `supabase/functions/`.

## Deploy de produção

Os dois deploys são manuais, em **Actions**:

1. **Deploy: banco (Supabase)**
   - Mostra o plano no resumo da execução.
   - Aplica as migrations e publica as Edge Functions da lista do workflow.
   - A opção "somente plano" só mostra o que seria feito.
2. **Deploy: promote (Vercel)**
   - Recusa se o banco tiver migrations pendentes.
   - Se estiver tudo em dia, coloca no ar o deploy do commit escolhido.

Um merge na `main` gera o build na Vercel, mas o domínio de produção só muda pelo promote.

## Contribuindo

- Cada mudança vai numa branch própria e entra na `main` por PR revisado.
- Textos da interface em pt-BR, com a terminologia da igreja: Líder, Timóteo, Anfitrião, Oferta, Tema, Visitante etc.
