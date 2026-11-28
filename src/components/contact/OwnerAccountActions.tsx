import { SettleWithoutMoneyButton } from "@/components/contact/SettleWithoutMoneyButton";
import { SettleToBalanceButton } from "@/components/contact/SettleToBalanceButton";
import { MergeContactButton } from "@/components/contact/MergeContactButton";
import { HideContactButton } from "@/components/contact/HideContactButton";

/**
 * The owner-only account actions of the contact file — «تسوية رصيد بدون فلوس», «تسوية برصيد (ربح / خسارة)», «دمج حساب تاني»,
 * «إخفاء / إظهار» — on a row of the customers / suppliers lists too (owner 2026-11-28). They sit in the row's «الإجراءات»
 * cell, so the row's «⋮» menu lists them; each renders nothing for anybody but the owner (the server refuses them too).
 * Archived accounts get neither merge nor hide; a «فرع داخلي» account gets no hide (the button knows).
 */
type Side = "customer" | "supplier";
export function OwnerAccountActions({ row, branchId, branchName, hidden, internal, onDone }: {
  row: { id: string; name: string; type: "customer" | "supplier" | "both"; opening_balance?: number | null; branch_id?: string | null; is_archived?: boolean | null };
  branchId: string | null; branchName?: string | null; hidden: boolean | null; internal: boolean; onDone?: () => void;
}) {
  const sides: Side[] = row.type === "both" ? ["customer", "supplier"] : [row.type];
  const side: Side = sides[0];
  return (
    <>
      <SettleWithoutMoneyButton contactId={row.id} contactName={row.name} side={side} sides={sides} defaultBranch={branchId ?? row.branch_id ?? null} onDone={onDone} />
      <SettleToBalanceButton contactId={row.id} contactName={row.name} side={side} sides={sides} defaultBranch={branchId ?? row.branch_id ?? null} onDone={onDone} />
      {!row.is_archived && (
        <MergeContactButton contactId={row.id} contactName={row.name} openingBalance={Number(row.opening_balance ?? 0)}
          branchId={row.branch_id ?? null} branchName={branchName ?? null} onDone={() => onDone?.()} />
      )}
      {!row.is_archived && hidden !== null && (
        <HideContactButton contactId={row.id} contactName={row.name} internalBranch={internal} hidden={hidden} onChanged={onDone} />
      )}
    </>
  );
}
