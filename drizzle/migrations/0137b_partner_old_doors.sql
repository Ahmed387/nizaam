-- 0137b: two more old partner doors that changed money with no till row and no journal entry:
--  edit_partner_transaction (rewrote any movement's amount / type / date in place) and create_partner_from_employee
--  (set initial_capital = money nobody put in a till). Owner rule (0137): a contribution is corrected on its own day by
--  edit_partner_contribution, after that cancel + new; a partner is added by save_partner and his capital comes in as a
--  «مساهمة» (branch, vessel, day). Originals kept as *_pre0137, no grants.
DO $mig$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['edit_partner_transaction(uuid,text,numeric,text,text,timestamptz)',
                           'create_partner_from_employee(uuid,text,numeric,numeric,numeric,date,text)'] LOOP
    IF to_regprocedure('public.' || split_part(f, '(', 1) || '_pre0137(' || split_part(f, '(', 2)) IS NULL THEN
      EXECUTE format('ALTER FUNCTION public.%s RENAME TO %I', f, split_part(f, '(', 1) || '_pre0137');
    END IF;
  END LOOP;
END
$mig$;
CREATE OR REPLACE FUNCTION public.edit_partner_transaction(_tx_id uuid, _transaction_type text, _amount numeric, _description text DEFAULT NULL, _month_year text DEFAULT NULL, _created_at timestamptz DEFAULT NULL)
 RETURNS void LANGUAGE plpgsql SET search_path TO 'public'
AS $f$ BEGIN RAISE EXCEPTION 'تعديل حركة الشريك: المساهمة بتتعدل في نفس يومها من صفحة الشريك، وغير كده الغيها واعمل حركة جديدة'; END $f$;
CREATE OR REPLACE FUNCTION public.create_partner_from_employee(_employee_id uuid, _partner_type text, _capital_share numeric, _operating_share numeric, _initial_capital numeric, _start_date date, _notes text)
 RETURNS uuid LANGUAGE plpgsql SET search_path TO 'public'
AS $f$ BEGIN RAISE EXCEPTION 'إضافة شريك بقت من «شريك جديد» (شريك بس / موظف وشريك)، ورأس ماله بيدخل بـ «مساهمة»'; END $f$;
REVOKE ALL ON FUNCTION public.edit_partner_transaction_pre0137(uuid,text,numeric,text,text,timestamptz),
  public.create_partner_from_employee_pre0137(uuid,text,numeric,numeric,numeric,date,text) FROM PUBLIC, anon, authenticated;
