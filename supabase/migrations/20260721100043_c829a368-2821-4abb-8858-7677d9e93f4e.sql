
ALTER TABLE public.voucher_categories
  ADD COLUMN IF NOT EXISTS is_deductible_from_profit BOOLEAN NOT NULL DEFAULT true;

-- Non-expense payment categories → not deductible
UPDATE public.voucher_categories
   SET is_deductible_from_profit = false
 WHERE type = 'payment'
   AND system_key IN ('advance','supplier_payment','customer_return','branch_transfer_out');

-- Receipts are never deducted from profit
UPDATE public.voucher_categories
   SET is_deductible_from_profit = false
 WHERE type = 'receipt';
