import { Link, useLocation } from "wouter";
import { LayoutDashboard, UtensilsCrossed, CalendarDays, ShoppingCart, Leaf, ChartColumnBig } from "lucide-react";
import { cn } from "@/lib/utils";

export function Navigation() {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/meal-plan", label: "Meal Plan", icon: CalendarDays },
    { href: "/recipes", label: "Recipes", icon: UtensilsCrossed },
    { href: "/summary", label: "Summary", icon: ChartColumnBig },
    { href: "/ingredients", label: "Ingredients", icon: Leaf },
    { href: "/shopping-list", label: "Shopping", icon: ShoppingCart },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-border/50 shadow-lg md:relative md:border-t-0 md:border-r md:w-64 md:h-screen md:flex-col md:p-6">
      <div className="hidden md:flex items-center gap-3 mb-10 px-2">
        <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center text-primary-foreground">
          <Leaf className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-primary font-display">NutriPlan</h1>
          <p className="text-xs text-muted-foreground">Eat well, live better</p>
        </div>
      </div>

      <div className="flex md:flex-col justify-around md:justify-start gap-1 md:gap-2 p-2 md:p-0">
        {navItems.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.href} href={item.href}>
              <button
                className={cn(
                  "flex flex-col md:flex-row items-center md:gap-3 p-2 md:px-4 md:py-3 rounded-xl transition-all duration-200 w-full",
                  isActive 
                    ? "text-primary bg-primary/10 font-semibold shadow-sm" 
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                <item.icon className={cn("w-6 h-6 md:w-5 md:h-5", isActive && "animate-pulse")} strokeWidth={isActive ? 2.5 : 2} />
                <span className="text-[10px] md:text-sm mt-1 md:mt-0">{item.label}</span>
              </button>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
