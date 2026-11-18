-- 0256 (owner 2026-11-18 «لما المالك يوافق علي الطلب يبقي الطلب باسم اللي عدل علي الطلب مش اللي وافق عليه»):
-- an approved document edit (0141) ran `apply_document_edit` as the OWNER, so the new return / invoice lines, vouchers, till rows
-- and the «سجل المستندات» rows carried the owner's name. Now `process_approval_request` checks the approver is the owner
-- (as before), records him in `approval_requests.admin_id`, then runs the edit AS THE REQUESTER (auth.uid() = requested_by for
-- that call only, then the owner's session comes back). The edit functions' owner-only gate (`doc_edit_is_direct`) lets the
-- requester through ONLY while `app.approved_edit` names that same pending request of his company — a flag only this trigger
-- sets (the browser cannot set server settings). His permissions / branch checks still run (assert_access).

CREATE OR REPLACE FUNCTION public.doc_edit_is_direct()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT auth.uid() IS NOT NULL AND (
       public.is_owner(auth.uid()) OR public.is_super_admin(auth.uid())
    -- 0256: an owner-approved request runs under the requester's name
    OR EXISTS (SELECT 1 FROM public.approval_requests ar
                WHERE ar.id::text = nullif(current_setting('app.approved_edit', true), '')
                  AND ar.requested_by = auth.uid() AND ar.status = 'pending'
                  AND ar.tenant_id = public.current_tenant_id()));
$function$;

CREATE OR REPLACE FUNCTION pg_temp.rep(src text, a text, b text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF position(a IN src) = 0 THEN RAISE EXCEPTION 'anchor not found: %', left(a, 80); END IF;
  RETURN replace(src, a, b);
END $$;

DO $m$
DECLARE d text := pg_get_functiondef('public.process_approval_request()'::regprocedure);
BEGIN
  d := pg_temp.rep(d, $a$  v_paid numeric;
BEGIN$a$, $b$  v_paid numeric;
  v_claims text; v_sub text;
BEGIN$b$);
  d := pg_temp.rep(d, $a$      IF NOT public.doc_edit_is_direct() THEN RAISE EXCEPTION 'الموافقة على تعديل المستندات للمالك بس'; END IF;
      PERFORM public.apply_document_edit(NEW.payload);$a$,
    $b$      IF NOT public.doc_edit_is_direct() THEN RAISE EXCEPTION 'الموافقة على تعديل المستندات للمالك بس'; END IF;
      -- 0256: the owner approves; the edit is recorded under the requester's name
      NEW.admin_id := coalesce(NEW.admin_id, auth.uid());
      v_claims := current_setting('request.jwt.claims', true);
      v_sub := current_setting('request.jwt.claim.sub', true);
      IF NEW.requested_by IS NOT NULL AND NEW.requested_by IS DISTINCT FROM auth.uid() THEN
        PERFORM set_config('request.jwt.claims',
          (coalesce(nullif(v_claims, ''), '{}')::jsonb || jsonb_build_object('sub', NEW.requested_by::text))::text, true);
        IF coalesce(v_sub, '') <> '' THEN PERFORM set_config('request.jwt.claim.sub', NEW.requested_by::text, true); END IF;
        PERFORM set_config('app.approved_edit', NEW.id::text, true);
      END IF;
      PERFORM public.apply_document_edit(NEW.payload);
      PERFORM set_config('request.jwt.claims', coalesce(v_claims, ''), true);
      IF coalesce(v_sub, '') <> '' THEN PERFORM set_config('request.jwt.claim.sub', v_sub, true); END IF;
      PERFORM set_config('app.approved_edit', '', true);$b$);
  EXECUTE d;
END $m$;
-- Dry-run 2026-11-18 (rolled back): manager ا/محمود علاء ضيف asked to edit SR09377 (3 → 2 pieces); calling apply_document_edit himself was refused; owner approved → new SR09387 created_by = the manager, document log «cancel» + «create» by the manager, approval_requests.admin_id = احمد ناصر, session back to the owner. security_exposed_definer_functions() = 0.
