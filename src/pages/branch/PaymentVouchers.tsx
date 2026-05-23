import { useParams } from "react-router-dom";
import { BranchLayout } from "@/components/layout/Layouts";
import { PageHeader } from "@/components/layout/AppShell";
import { VouchersTable } from "@/components/VouchersTable";

export default function PaymentVouchers() {
  const { id } = useParams<{ id: string }>();
  return (
    <BranchLayout>
      <PageHeader title="سندات الصرف" subtitle="كل المبالغ المصروفة من الفرع" />
      <VouchersTable branchId={id} type="payment" />
    </BranchLayout>
  );
}
