import { Navigation } from "./Navigation";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-background">
      <Navigation />
      <main className="flex-1 pb-24 md:pb-8 p-4 md:p-8 overflow-y-auto h-screen">
        <div className="max-w-6xl mx-auto page-transition">
          {children}
        </div>
      </main>
    </div>
  );
}
