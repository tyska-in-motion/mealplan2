import { Link, useLocation } from "wouter";
import { LayoutDashboard, UtensilsCrossed, CalendarDays, ShoppingCart, Leaf, ChartColumnBig, Soup } from "lucide-react";
import { cn } from "@/lib/utils";

export function Navigation() {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/summary", label: "Summary", icon: ChartColumnBig },
    { href: "/meal-plan", label: "Meal Plan", icon: CalendarDays },
    { href: "/shared-meals", label: "Wspólne", icon: Soup },
    { href: "/recipes", label: "Recipes", icon: UtensilsCrossed },
    { href: "/ingredients", label: "Ingredients", icon: Leaf },
    { href: "/shopping-list", label: "Shopping", icon: ShoppingCart },
  ];

  return (
    <nav
      aria-label="Main navigation"
      className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 border-t border-border/70 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] pb-[max(0.4rem,env(safe-area-inset-bottom))] md:relative md:border-t-0 md:border-r md:w-64 md:h-screen md:flex-col md:p-6 md:pb-6"
    >
      <div className="hidden md:flex items-center gap-3 mb-10 px-2">
        <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-primary-foreground">
          <Leaf className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-primary font-display">NutriPlan</h1>
          <p className="text-xs text-muted-foreground">Eat well, live better</p>
        </div>
      </div>

      <div className="flex md:flex-col items-stretch justify-start gap-1 md:gap-2 p-1.5 md:p-0 overflow-x-auto md:overflow-visible no-scrollbar">
        {navItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.href} href={item.href}>
              <button
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex h-14 min-w-[4.35rem] shrink-0 flex-col md:h-auto md:min-w-0 md:flex-row items-center justify-center md:justify-start md:gap-3 px-1.5 py-1.5 md:px-4 md:py-3 rounded-xl transition-all duration-200 w-auto md:w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  isActive 
                    ? "text-primary bg-primary/10 font-semibold shadow-sm" 
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                <item.icon className={cn("w-4 h-4 md:w-5 md:h-5", isActive && "animate-pulse")} strokeWidth={isActive ? 2.5 : 2} />
                <span className="text-[10px] leading-tight md:text-sm mt-1 md:mt-0 text-center md:text-left">{item.label}</span>
              </button>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
