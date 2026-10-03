import { ContactLookup } from "@/components/ContactLookup";
import type { ContactLookupRow } from "@/lib/contactLookup";

interface Props {
  branchId: string | null | undefined;
  value: string;
  onChange: (id: string, contact: ContactLookupRow | null) => void;
  placeholder?: string;
  className?: string;
}

/** Customer picker for sales documents — thin wrapper over the unified ContactLookup. */
export function CustomerSelect({ branchId, value, onChange, placeholder = "— اختر عميل (اختياري) —", className }: Props) {
  return (
    <ContactLookup
      branchId={branchId}
      kind="customer"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      emptyLabel="عميل نقدي / غير محدد (اختياري)"
      className={className}
    />
  );
}
