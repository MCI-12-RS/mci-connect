
ALTER TYPE public.permission_action ADD VALUE IF NOT EXISTS 'view_own_reports';
ALTER TYPE public.permission_action ADD VALUE IF NOT EXISTS 'view_all_reports';
ALTER TYPE public.permission_action ADD VALUE IF NOT EXISTS 'submit_own_cell_report';
ALTER TYPE public.permission_action ADD VALUE IF NOT EXISTS 'submit_any_visible_report';
