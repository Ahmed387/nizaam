import { ArrowDownCircle, ArrowUpCircle, HandCoins, Landmark, TrendingUp } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { formatEGP } from "@/lib/format";
import type { CardKey, PartnerCards } from "@/lib/partners";
import { cn } from "@/lib/utils";

const SRC = "حركات الشريك (partner_cards) — كل حركة شغالة، الملغي مش محسوب";

/**
 * The five partner cards (owner «صح» 2026-11-03). Clicking a card shows only its movements under it.
 * Example: المساهمات 1,000,000 · المسحوبات من رأس المال 200,000 · رأس المال لحد النهارده 800,000 · صافي الربح 150,000 · السلف 0.
 */
export function PartnerCardsRow({ cards, selected, onSelect }: {
  cards: Pick<PartnerCards, "contributions" | "capital_withdrawals" | "capital" | "profit" | "profit_in" | "profit_out" | "advances">;
  selected?: CardKey | null;
  onSelect?: (k: CardKey | null) => void;
}) {
  const items: { key: CardKey; label: string; value: number; hint: string; meaning: string; formula: string; icon: JSX.Element; accent: any }[] = [
    { key: "contributions", label: "المساهمات", value: cards.contributions, hint: "مبيقلش أبداً",
      meaning: "كل الفلوس اللي الشريك حطها في الشركة من أول يوم", formula: "رأس المال الأول + كل مساهمة", icon: <ArrowUpCircle className="w-5 h-5" />, accent: "success" },
    { key: "capital_withdrawals", label: "المسحوبات من رأس المال", value: cards.capital_withdrawals, hint: "اللي سحبه من رأس ماله",
      meaning: "اللي سحبه وقال إنه «من رأس المال»", formula: "مجموع السحب من رأس المال", icon: <ArrowDownCircle className="w-5 h-5" />, accent: "destructive" },
    { key: "capital", label: "رأس المال لحد النهارده", value: cards.capital, hint: "بيتقسم عليه الربح",
      meaning: "رأس ماله الحالي — نسبته في التوزيع بتتحسب منه (التغيير بيسري من أول الشهر اللي بعده)", formula: "المساهمات − المسحوبات من رأس المال", icon: <Landmark className="w-5 h-5" />, accent: "primary" },
    { key: "profit", label: "صافي الربح", value: cards.profit, hint: `اتحسبله ${formatEGP(cards.profit_in)} − طلع ${formatEGP(cards.profit_out)}`,
      meaning: "الربح اللي اتحسبله ولسه ماسحبوش", formula: "نصيبه من التوزيع + حصة التشغيل + مرتبه من الربح − السحب من الربح − سداد السلف من نصيبه", icon: <TrendingUp className="w-5 h-5" />, accent: cards.profit < 0 ? "destructive" : "success" },
    { key: "advances", label: "السلف", value: cards.advances, hint: "بتتخصم من التوزيع الجاي",
      meaning: "اللي سحبه أكتر من ربحه — أول ما ياخد نصيب بيتخصم منه", formula: "مجموع الباقي من كل سلفة مفتوحة", icon: <HandCoins className="w-5 h-5" />, accent: cards.advances > 0 ? "warning" : "secondary" },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
      {items.map((c) => (
        <StatCard
          key={c.key}
          label={c.label}
          value={formatEGP(c.value)}
          hint={c.hint}
          metricHint={{ meaning: c.meaning, source: SRC, formula: c.formula }}
          icon={c.icon}
          accent={c.accent}
          role={onSelect ? "button" : undefined}
          tabIndex={onSelect ? 0 : undefined}
          aria-pressed={onSelect ? selected === c.key : undefined}
          onClick={onSelect ? () => onSelect(selected === c.key ? null : c.key) : undefined}
          onKeyDown={onSelect ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(selected === c.key ? null : c.key); } } : undefined}
          className={cn(onSelect && "cursor-pointer", selected === c.key && "ring-2 ring-primary")}
        />
      ))}
    </div>
  );
}
