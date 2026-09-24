ALTER TABLE public.stock_transfers ADD COLUMN IF NOT EXISTS hidden_for_branches uuid[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN public.stock_transfers.hidden_for_branches IS 'Visual-only soft hide per branch for rejected transfers; ledger untouched';

CREATE OR REPLACE FUNCTION public.hide_rejected_transfer(_transfer_id uuid, _branch_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  SELECT id, status, from_branch_id, to_branch_id, tenant_id INTO r FROM stock_transfers WHERE id = _transfer_id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'التحويل غير موجود'; END IF;
  IF r.status::text <> 'rejected' THEN RAISE EXCEPTION 'يمكن إخفاء التحويلات المرفوضة فقط'; END IF;
  IF _branch_id NOT IN (r.from_branch_id, r.to_branch_id) THEN RAISE EXCEPTION 'التحويل لا يخص هذا الفرع'; END IF;
  IF r.tenant_id IS DISTINCT FROM public.current_tenant_id() THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  IF NOT public.user_in_branch(auth.uid(), _branch_id) THEN RAISE EXCEPTION 'غير مصرح لهذا الفرع'; END IF;
  UPDATE stock_transfers SET hidden_for_branches = array_append(hidden_for_branches, _branch_id)
   WHERE id = _transfer_id AND NOT (_branch_id = ANY(hidden_for_branches));
END $$;
REVOKE ALL ON FUNCTION public.hide_rejected_transfer(uuid, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.hide_rejected_transfer(uuid, uuid) TO authenticated;