
-- Add new permission enum values
ALTER TYPE public.permission_action ADD VALUE IF NOT EXISTS 'assign_role';
ALTER TYPE public.permission_action ADD VALUE IF NOT EXISTS 'view_sensitive_data';
ALTER TYPE public.permission_action ADD VALUE IF NOT EXISTS 'change_member_password';
