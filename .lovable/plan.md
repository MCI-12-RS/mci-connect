# Arquitetura de Eventos (Audit Log)

Implementação de uma tabela timeseries `public.events` populada **exclusivamente por triggers de banco** e por um **RPC restrito** para eventos de autenticação. O frontend **não pode inserir** eventos diretamente.

Princípio de armazenamento: **apenas campos-chave**, sem snapshots completos da linha. O suficiente para reconstruir uma timeline humanizada (quem, o quê, quando, sobre qual entidade, e quais campos relevantes mudaram).

---

## 1. Schema da tabela `events`

### Enums
```sql
CREATE TYPE public.event_action AS ENUM (
  'create', 'update', 'delete',
  'login', 'login_failed', 'logout',
  'password_changed'
);

CREATE TYPE public.event_entity AS ENUM (
  'member', 'cell', 'cell_report', 'cell_report_participant', 'auth'
);
```

### Tabela
```sql
CREATE TABLE public.events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,            -- auth.uid() no momento da ação (pode ser null em login_failed)
  actor_label  text,             -- nome do membro autor (resolvido via members.auth_user_id)
  action       event_action NOT NULL,
  entity       event_entity NOT NULL,
  entity_id    uuid,             -- id da linha afetada (members.id, cells.id, ...)
  entity_label text,             -- ex.: nome do membro, nome da célula, "Relatório de {Célula} em {data}"
  description  text NOT NULL,    -- frase pt-BR pronta para timeline
  changed_fields text[],         -- nomes das colunas alteradas (apenas em update)
  metadata     jsonb,            -- chaves mínimas: ver seção 4
  success      boolean NOT NULL DEFAULT true,
  error_reason text
);

CREATE INDEX events_occurred_at_idx ON public.events (occurred_at DESC);
CREATE INDEX events_entity_idx      ON public.events (entity, entity_id);
CREATE INDEX events_actor_idx       ON public.events (actor_user_id);
```

---

## 2. RLS — bloqueio total de escrita pelo browser

```sql
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- Leitura: somente quem tem permissão view_audit_log
CREATE POLICY "Events view policy" ON public.events
  FOR SELECT TO authenticated
  USING (user_has_permission(auth.uid(), 'view_audit_log'));

-- Sem policies de INSERT/UPDATE/DELETE → bloqueado para todos os roles, inclusive authenticated.
-- Triggers usam SECURITY DEFINER e bypassam RLS.
```

Adicionar enum value:
```sql
ALTER TYPE public.permission_action ADD VALUE 'view_audit_log';
```

---

## 3. Função privada `_log_event` (SECURITY DEFINER)

Centraliza a inserção. Usada pelos triggers e pelo RPC de auth.

```sql
CREATE OR REPLACE FUNCTION public._log_event(
  _action event_action,
  _entity event_entity,
  _entity_id uuid,
  _entity_label text,
  _description text,
  _changed_fields text[] DEFAULT NULL,
  _metadata jsonb DEFAULT NULL,
  _success boolean DEFAULT true,
  _error_reason text DEFAULT NULL,
  _actor_user_id uuid DEFAULT auth.uid()
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _actor_label text;
BEGIN
  SELECT name INTO _actor_label FROM members WHERE auth_user_id = _actor_user_id LIMIT 1;
  INSERT INTO public.events (
    actor_user_id, actor_label, action, entity, entity_id, entity_label,
    description, changed_fields, metadata, success, error_reason
  ) VALUES (
    _actor_user_id, _actor_label, _action, _entity, _entity_id, _entity_label,
    _description, _changed_fields, _metadata, _success, _error_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION public._log_event FROM public, anon, authenticated;
```

---

## 4. O que vai em `metadata` (campos-chave por entidade)

Mantemos o **mínimo** para humanizar a timeline futura sem inflar storage. Nunca o snapshot completo.

### `member`
- `create`: `{ name, role_id, leader_id, is_pastor }`
- `update`: para **cada campo em `changed_fields`** salvar `{ <campo>: { from, to } }` apenas para campos relevantes (whitelist):
  `name, role_id, leader_id, spouse_id, is_pastor, has_leadership, is_active, is_baptized, gender`
  Demais campos (endereço, telefone, notes, avatar_url, instagram, cpf, birth_date, baptism_date) entram apenas em `changed_fields` **sem valores** (privacidade + storage).
- `delete`: `{ name, role_id, leader_id }`

### `cell`
- `create`: `{ name, type, leader_id, timothy_id, host_id, is_active }`
- `update`: whitelist com from/to: `name, type, leader_id, timothy_id, host_id, is_active, meeting_day, meeting_time, neighborhood, city`
- `delete`: `{ name, leader_id }`

### `cell_report`
- `create`: `{ cell_id, date, was_held, offering, theme, participants_count }`
- `update`: whitelist com from/to: `date, was_held, offering, theme, reason_not_held`
- `delete`: `{ cell_id, date }`

### `cell_report_participant`
- `create`/`delete`: `{ report_id, member_id }` — descrição: "Adicionou/Removeu {membro} do relatório de {célula} em {data}"

### `auth`
- `login`: `{ method: 'password' | 'oauth', email_or_identifier_masked }`
- `login_failed`: `{ identifier_masked, reason }` (`actor_user_id` null)
- `logout`: `{}`
- `password_changed`: `{ target_member_id }` (registrado pela edge function)

---

## 5. Triggers

Um trigger `AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW` por tabela:
`members`, `cells`, `cell_reports`, `cell_report_participants`.

Cada trigger:
1. Resolve `entity_label` (nome do membro / nome da célula / `"Relatório de {nome_célula} em {data}"`).
2. No `UPDATE`, calcula `changed_fields` comparando `OLD` vs `NEW` apenas nas colunas da whitelist.
3. Monta `description` em pt-BR (ex.: *"Rafael atualizou o líder e o timóteo da Célula Biguás 600"*).
4. Monta `metadata` conforme seção 4.
5. Chama `_log_event(...)`.
6. **Nunca falha a operação principal**: bloco `BEGIN ... EXCEPTION WHEN OTHERS THEN ... END` que apenas loga o erro com `RAISE WARNING` (não propaga).

> Observação: triggers rodam dentro da transação. Se a operação principal sofrer rollback, o evento também sofre — comportamento desejado (não logamos ações que não aconteceram).

---

## 6. Eventos de autenticação — RPC restrito

Triggers não capturam login/logout. Criamos um RPC chamado pelo frontend:

```sql
CREATE OR REPLACE FUNCTION public.log_auth_event(
  _action event_action,           -- restrito a 'login' | 'login_failed' | 'logout'
  _success boolean,
  _identifier text DEFAULT NULL,  -- email/cpf/telefone usado na tentativa
  _reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _action NOT IN ('login', 'login_failed', 'logout') THEN
    RAISE EXCEPTION 'Ação inválida para log_auth_event';
  END IF;

  PERFORM public._log_event(
    _action      := _action,
    _entity      := 'auth',
    _entity_id   := auth.uid(),
    _entity_label:= NULL,
    _description := CASE _action
      WHEN 'login' THEN 'Login realizado'
      WHEN 'login_failed' THEN 'Falha no login'
      WHEN 'logout' THEN 'Logout realizado'
    END,
    _metadata    := jsonb_build_object(
                      'identifier_masked', public._mask_identifier(_identifier),
                      'reason', _reason),
    _success     := _success,
    _error_reason:= _reason,
    _actor_user_id := auth.uid()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_auth_event TO anon, authenticated;
```

Helper `_mask_identifier` (privado): mascara emails (`r***@gmail.com`), CPF (`***.456.***-**`) e telefone (`(11) ****-1234`).

> `login_failed` precisa ser chamado por `anon` (usuário ainda não autenticado), por isso o GRANT inclui `anon`. O RPC é a **única** porta para eventos de auth.

---

## 7. Edge function `change-member-password`

Após sucesso no `auth.admin.updateUserById`, chamar via service role:
```ts
await supabase.rpc('_log_event_admin', { ... }) // wrapper público restrito
```
Ou inserir diretamente com service role (bypass RLS), com `action='password_changed'`, `entity='member'`, `entity_id=member_id`, `actor_user_id=callingUser.id`, `metadata={ target_member_id }`.

---

## 8. Frontend

### Chamadas a `log_auth_event`
- `src/pages/Login.tsx`: após `signInWithPassword` — chama `log_auth_event('login', true)` no sucesso, `log_auth_event('login_failed', false, identifier, error.message)` no erro.
- `src/contexts/AuthContext.tsx`: no `signOut`, antes de limpar a sessão, chamar `log_auth_event('logout', true)`.

### Página de auditoria (`/eventos`)
- Rota nova protegida pela permissão `view_audit_log`.
- Lista paginada com filtros: período, ator, entidade, ação, sucesso/erro.
- Colunas: Data/hora, Ator, Ação, Entidade, Descrição, Status.
- Linha clicável → drawer com `metadata`, `changed_fields`, `error_reason`.
- Item no `AppSidebar` "Auditoria" visível só para quem tem `view_audit_log`.

### Atribuição da permissão
- Permissão `view_audit_log` concedida ao role admin via migration.

---

## 9. Garantias de segurança

| Vetor | Mitigação |
|---|---|
| Frontend tenta `INSERT` em `events` | RLS bloqueia (sem policy de INSERT) |
| Frontend chama `_log_event` direto | `REVOKE EXECUTE` — função privada |
| Usuário forja login bem-sucedido falso | `log_auth_event` usa `auth.uid()` para `actor_user_id`; `login_failed` é apenas informativo |
| Bypass via SQL externo / outras edge functions | Triggers capturam **toda** mutação em members/cells/reports |
| Rollback da transação | Evento também sofre rollback (consistência) |

---

## 10. Ordem de execução

1. Migration: enums, tabela `events`, índices, RLS, permissão `view_audit_log`.
2. Migration: `_log_event`, `_mask_identifier`, `log_auth_event`.
3. Migration: triggers em `members`, `cells`, `cell_reports`, `cell_report_participants`.
4. Migration: conceder `view_audit_log` ao role admin.
5. Frontend: instrumentar `Login.tsx` e `AuthContext.tsx`.
6. Frontend: nova página `/eventos` + item de menu.
7. Edge function `change-member-password`: registrar evento `password_changed`.

Nada de instrumentação em formulários CRUD — triggers cobrem tudo.
