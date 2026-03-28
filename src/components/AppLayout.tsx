import { ReactNode } from "react";
import AppSidebar from "./AppSidebar";

const AppLayout = ({ children }: { children: ReactNode }) => {
  return (
    <div className="flex min-h-screen">
      <AppSidebar />
      <main className="flex-1 p-4 md:p-6 overflow-auto pt-14 md:pt-6">
        {children}
      </main>
    </div>
  );
};

export default AppLayout;
