import { Navigation } from "./Navigation";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-background">
      <Navigation />
      <main className="flex-1 px-3 pt-3 pb-[calc(5.75rem+env(safe-area-inset-bottom))] md:px-8 md:pt-8 md:pb-8 overflow-y-auto h-screen">
        <div className="max-w-6xl mx-auto page-transition">
          {children}
        </div>
      </main>
    </div>
  );
}
