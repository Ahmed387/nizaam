import { formatNumber } from "@/lib/format";

type FinancialAmountSize = "sm" | "md" | "lg" | "hero";

interface FinancialAmountProps {
  value: number | string;
  currency?: boolean;
  size?: FinancialAmountSize;
  className?: string;
  currencyClassName?: string;
}

const SIZE_CLASSES: Record<FinancialAmountSize, Record<"standard" | "large" | "extreme", string>> = {
  sm: {
    standard: "text-lg",
    large: "text-base sm:text-lg",
    extreme: "text-sm sm:text-base",
  },
  md: {
    standard: "text-xl sm:text-2xl",
    large: "text-lg sm:text-xl",
    extreme: "text-base sm:text-lg",
  },
  lg: {
    standard: "text-2xl sm:text-3xl",
    large: "text-xl sm:text-2xl",
    extreme: "text-lg",
  },
  hero: {
    standard: "text-3xl sm:text-4xl lg:text-5xl",
    large: "text-2xl sm:text-3xl lg:text-4xl",
    extreme: "text-xl sm:text-2xl lg:text-3xl",
  },
};

export function FinancialAmount({
  value,
  currency = true,
  size = "md",
  className = "",
  currencyClassName = "",
}: FinancialAmountProps) {
  const raw = typeof value === "number" ? formatNumber(value) : String(value);
  const amount = raw.replace(/\s*ج\.م\s*$/u, "").trim();
  const isMasked = !/[0-9٠-٩]/u.test(amount);
  const digitCount = amount.replace(/[^0-9٠-٩]/gu, "").length;
  const scale = digitCount <= 6 ? "standard" : digitCount <= 9 ? "large" : "extreme";
  const fullValue = currency && !isMasked ? `${amount} ج.م` : amount;

  return (
    <span
      className={`inline-flex max-w-full min-w-0 flex-wrap items-baseline justify-center gap-x-1 tabular-nums font-bold leading-tight ${SIZE_CLASSES[size][scale]} ${className}`}
      dir="ltr"
      title={fullValue}
    >
      <span className="max-w-full break-words">{amount}</span>
      {currency && !isMasked && (
        <span className={`mr-1 shrink-0 text-xs sm:text-sm font-normal text-muted-foreground ${currencyClassName}`}>
          ج.م
        </span>
      )}
    </span>
  );
}