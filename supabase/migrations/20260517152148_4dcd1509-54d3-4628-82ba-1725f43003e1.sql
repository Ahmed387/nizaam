-- 1) أعمدة صورة البطاقة على الموظفين
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS national_id TEXT,
  ADD COLUMN IF NOT EXISTS national_id_front_url TEXT,
  ADD COLUMN IF NOT EXISTS national_id_back_url TEXT;

-- 2) Bucket خاص لصور البطاقات (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('employee-ids', 'employee-ids', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "emp_ids_read" ON storage.objects;
CREATE POLICY "emp_ids_read" ON storage.objects FOR SELECT
USING (
  bucket_id = 'employee-ids' AND (
    public.is_super_admin(auth.uid())
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(),'branch_manager')
  )
);

DROP POLICY IF EXISTS "emp_ids_write" ON storage.objects;
CREATE POLICY "emp_ids_write" ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'employee-ids' AND (
    public.is_super_admin(auth.uid())
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(),'branch_manager')
  )
);

DROP POLICY IF EXISTS "emp_ids_update" ON storage.objects;
CREATE POLICY "emp_ids_update" ON storage.objects FOR UPDATE
USING (
  bucket_id = 'employee-ids' AND (
    public.is_super_admin(auth.uid())
    OR public.is_admin(auth.uid())
    OR public.has_role(auth.uid(),'branch_manager')
  )
);

DROP POLICY IF EXISTS "emp_ids_delete" ON storage.objects;
CREATE POLICY "emp_ids_delete" ON storage.objects FOR DELETE
USING (
  bucket_id = 'employee-ids' AND (
    public.is_super_admin(auth.uid())
    OR public.is_admin(auth.uid())
  )
);

-- 3) جدول الحضور والانصراف
CREATE TABLE IF NOT EXISTS public.attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  branch_id UUID NOT NULL,
  employee_id UUID NOT NULL,
  employee_name TEXT NOT NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  check_in TIMESTAMPTZ,
  check_out TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'present',
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id, date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_branch_date ON public.attendance(branch_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON public.attendance(employee_id, date DESC);

ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS att_read ON public.attendance;
CREATE POLICY att_read ON public.attendance FOR SELECT
USING (
  is_super_admin(auth.uid())
  OR (tenant_id = current_tenant_id() AND (
        is_admin(auth.uid())
        OR has_role(auth.uid(),'viewer')
        OR user_in_branch(auth.uid(), branch_id)
     ))
);

DROP POLICY IF EXISTS att_write ON public.attendance;
CREATE POLICY att_write ON public.attendance FOR ALL
USING (
  is_super_admin(auth.uid())
  OR (tenant_id = current_tenant_id() AND (
        is_admin(auth.uid())
        OR (user_in_branch(auth.uid(), branch_id) AND
            (has_role(auth.uid(),'branch_manager') OR has_role(auth.uid(),'cashier')))
     ))
)
WITH CHECK (
  is_super_admin(auth.uid())
  OR (tenant_id = current_tenant_id() AND (
        is_admin(auth.uid())
        OR (user_in_branch(auth.uid(), branch_id) AND
            (has_role(auth.uid(),'branch_manager') OR has_role(auth.uid(),'cashier')))
     ))
);

DROP POLICY IF EXISTS att_suspended ON public.attendance;
CREATE POLICY att_suspended ON public.attendance AS RESTRICTIVE FOR ALL
USING (is_super_admin(auth.uid()) OR NOT current_tenant_is_suspended())
WITH CHECK (is_super_admin(auth.uid()) OR NOT current_tenant_is_suspended());

DROP TRIGGER IF EXISTS trg_attendance_touch ON public.attendance;
CREATE TRIGGER trg_attendance_touch
  BEFORE UPDATE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_attendance_set_tenant ON public.attendance;
CREATE TRIGGER trg_attendance_set_tenant
  BEFORE INSERT ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_from_user();

DROP TRIGGER IF EXISTS trg_attendance_audit ON public.attendance;
CREATE TRIGGER trg_attendance_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- 4) Viewer: SELECT-only على كل جداول الشركة
DO $$
DECLARE t text;
DECLARE tables text[] := ARRAY[
  'branches','categories','customers','suppliers','employees','products',
  'invoices','invoice_items','invoice_payments','returns','return_items',
  'expenses','shipments','shipment_items','stock_transfers','salaries',
  'advances','advance_requests','advance_payments','supplier_payments',
  'pre_orders','pre_order_transactions','treasury','treasury_transfers',
  'price_list_items','price_list_sources'
];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    BEGIN
      EXECUTE format('DROP POLICY IF EXISTS viewer_read ON public.%I', t);
      EXECUTE format(
        'CREATE POLICY viewer_read ON public.%I FOR SELECT USING (tenant_id = current_tenant_id() AND has_role(auth.uid(),''viewer''))',
        t
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END $$;