import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Store, Building2, BarChart3, Users, Shield, Zap, Check, ArrowLeft } from "lucide-react";

export default function Landing() {
  const features = [
    { icon: Building2, title: "متعدد الفروع", desc: "أدر فروعك كلها من مكان واحد بسهولة" },
    { icon: BarChart3, title: "تقارير مفصلة", desc: "تقارير مبيعات ومخزون ومصاريف لحظية" },
    { icon: Users, title: "إدارة الموظفين", desc: "رواتب وسلف وصلاحيات لكل موظف" },
    { icon: Shield, title: "أمان وعزل بيانات", desc: "بيانات شركتك معزولة تماماً وآمنة" },
    { icon: Zap, title: "نقاط بيع سريعة", desc: "واجهة كاشير سهلة وسريعة" },
    { icon: Store, title: "إدارة المخزون", desc: "تتبع الشحنات والتحويلات بين الفروع" },
  ];

  const planFeatures = [
    "عدد غير محدود من الفواتير",
    "إدارة المخزون والشحنات",
    "تقارير تفصيلية ومتقدمة",
    "إدارة الموظفين والرواتب",
    "نظام صلاحيات متكامل",
    "دعم فني سريع",
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="border-b border-border/40 backdrop-blur-sm sticky top-0 z-50 bg-background/80">
        <div className="container mx-auto flex items-center justify-between h-16 px-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg gradient-primary flex items-center justify-center">
              <Store className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg gradient-text">Nexa Store</span>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/login"><Button variant="ghost">دخول</Button></Link>
            <Link to="/signup"><Button className="btn-gradient">ابدأ مجاناً</Button></Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden py-20 md:py-32">
        <div className="absolute inset-0 opacity-30 pointer-events-none">
          <div className="absolute top-1/4 right-1/3 w-[500px] h-[500px] rounded-full blur-3xl gradient-primary" />
          <div className="absolute bottom-0 left-1/4 w-[400px] h-[400px] rounded-full blur-3xl bg-secondary/40" />
        </div>
        <div className="container relative mx-auto px-4 text-center max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
            <Zap className="w-4 h-4" /> مجاني بالكامل — بدون حدود
          </div>
          <h1 className="text-4xl md:text-6xl font-extrabold mb-6 leading-tight">
            نظام إدارة <span className="gradient-text">المتاجر متعددة الفروع</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground mb-8">
            أدر فروعك ومخزونك ومبيعاتك وموظفيك من مكان واحد. سريع، آمن، وسهل الاستخدام.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link to="/signup">
              <Button size="lg" className="btn-gradient h-12 text-base px-8">
                أنشئ حساب شركتك الآن <ArrowLeft className="w-5 h-5 mr-2" />
              </Button>
            </Link>
            <Link to="/login">
              <Button size="lg" variant="outline" className="h-12 text-base px-8">
                لدي حساب بالفعل
              </Button>
            </Link>
          </div>
          <p className="text-xs text-muted-foreground mt-4">بدون بطاقة ائتمان • تفعيل فوري</p>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 bg-muted/20">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-3">كل ما تحتاجه لإدارة متجرك</h2>
            <p className="text-muted-foreground">مزايا متكاملة في منصة واحدة</p>
          </div>
          <div className="grid md:grid-cols-3 gap-5 max-w-5xl mx-auto">
            {features.map((f, i) => (
              <div key={i} className="card-elevated p-6 hover-lift">
                <div className="w-11 h-11 rounded-lg gradient-primary flex items-center justify-center mb-4">
                  <f.icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="font-bold text-lg mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* Footer */}
      <footer className="border-t border-border/40 py-8">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} Nexa Store — جميع الحقوق محفوظة
        </div>
      </footer>
    </div>
  );
}
