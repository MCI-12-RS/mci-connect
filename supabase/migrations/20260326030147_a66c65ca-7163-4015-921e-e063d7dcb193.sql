
-- Add cell-related permissions to the enum
ALTER TYPE public.permission_action ADD VALUE IF NOT EXISTS 'create_cell';
ALTER TYPE public.permission_action ADD VALUE IF NOT EXISTS 'edit_cell';
ALTER TYPE public.permission_action ADD VALUE IF NOT EXISTS 'delete_cell';
