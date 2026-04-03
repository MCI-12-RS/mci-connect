
-- Add is_default flag to roles
ALTER TABLE public.roles ADD COLUMN is_default boolean NOT NULL DEFAULT false;

-- Ensure only one role can be default
CREATE UNIQUE INDEX idx_roles_single_default ON public.roles (is_default) WHERE is_default = true;
