import React, { useState } from 'react';
import { Outlet } from 'react-router-dom';
import { DashboardSidebar } from './DashboardSidebar';
import { DashboardTopBar } from './DashboardTopBar';
import { Menu, X } from 'lucide-react';

export const EmployerLayout: React.FC = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

  return (
    <div className="min-h-screen bg-(--bg) text-(--text)">
      {/* Desktop Sidebar */}
      <div className="hidden lg:block fixed left-0 top-0 h-screen w-64 z-50">
        <DashboardSidebar />
      </div>

      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]"
          onClick={toggleSidebar}
        />
      )}

      {/* Mobile Sidebar Content */}
      <div
        className={`
                lg:hidden fixed left-0 top-0 h-full w-64 z-[70] transition-transform duration-300 ease-in-out transform
                ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
            `}
      >
        <DashboardSidebar onClose={toggleSidebar} />
      </div>

      {/* Main Content Area */}
      <div className="flex flex-col min-h-screen lg:pl-64">
        {/* Mobile Top Bar */}
        <header className="lg:hidden h-16 px-6 border-b border-(--border) bg-(--bg)/80 backdrop-blur-xl flex items-center justify-between sticky top-0 z-40">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg grid place-items-center font-extrabold text-(--on-accent) text-sm tracking-tight shadow-(--shadow-sm) bg-linear-to-br from-(--accent) to-(--accent2)">
              P
            </div>
            <span className="text-xl font-extrabold tracking-tight">
              Pay<span className="text-(--accent)">D</span>
            </span>
          </div>
          <button
            onClick={toggleSidebar}
            className="p-2 rounded-lg bg-(--surface) border border-(--border) hover:bg-(--surface-hi) transition-colors"
            aria-label="Toggle Sidebar"
          >
            {isSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </header>

        <DashboardTopBar />

        <main className="flex-1 p-6 lg:p-10 max-w-[1600px] w-full mx-auto">
          <div className="page-fade">
            <Outlet />
          </div>
        </main>

        <footer className="p-8 border-t border-(--border) text-(--muted) text-xs flex flex-wrap justify-between items-center gap-4">
          <p>© {new Date().getFullYear()} PayD — Licensed under Apache 2.0</p>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-(--accent)" />
            <span className="uppercase tracking-widest font-mono text-[10px]">
              Stellar Testnet Node · V22.1.0
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default EmployerLayout;
