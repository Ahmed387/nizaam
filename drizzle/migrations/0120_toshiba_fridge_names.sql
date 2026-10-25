-- 0120 — the two Toshiba fridges registered under two codes are two different models (owner «نفذ» 2026-10-25):
-- DMN = fixed speed (Toshiba Egypt), PMN = inverter. Names now say which is which, and the 338 L DMN rows had
-- the PMN model in «الموديل». Text only — prices, quantities, invoices untouched (invoice lines keep their own name).
UPDATE public.products SET name = 'ثلاجة توشيبا 338 لتر نوفروست إنفرتر سلفر - GR-RT468WE-PMN(49)'
 WHERE sku = 'GR-RT468WE-PMN (49)' AND archived_at IS NULL;
UPDATE public.products SET name = 'ثلاجة توشيبا 338 لتر نوفروست عادي - GR-RT468WE-DMN(49)', model = 'GR-RT468WE-DMN(49)'
 WHERE sku = 'GR-RT468WE-DMN(49)' AND archived_at IS NULL;
UPDATE public.products SET name = 'ثلاجة توشيبا 411 لتر نوفروست إنفرتر - GR-RT559WE-PMN(49)'
 WHERE sku = 'GR-RT559WE-PMN(49)' AND archived_at IS NULL;
UPDATE public.products SET name = 'ثلاجة توشيبا 411 لتر نوفروست عادي - GR-RT559WE-DMN(49)'
 WHERE sku = 'GR-RT559WE-DMN 49' AND archived_at IS NULL;
