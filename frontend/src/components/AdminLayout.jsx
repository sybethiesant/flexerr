import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Settings,
  ListChecks,
  Trash2,
  Users,
  FileText,
  LayoutDashboard,
  FolderTree
} from 'lucide-react';

const adminNavItems = [
  { path: '/admin', label: 'Overview', icon: LayoutDashboard, exact: true },
  { path: '/admin/settings', label: 'Settings', icon: Settings },
  { path: '/admin/rules', label: 'Cleanup Rules', icon: ListChecks },
  { path: '/admin/categorization', label: 'Categorization', icon: FolderTree },
  { path: '/admin/queue', label: 'Queue', icon: Trash2 },
  { path: '/admin/users', label: 'Users', icon: Users },
  { path: '/admin/logs', label: 'Logs', icon: FileText },
];

export default function AdminLayout({ children }) {
  const location = useLocation();

  const isActive = (item) => {
    if (item.exact) {
      return location.pathname === item.path;
    }
    return location.pathname.startsWith(item.path);
  };

  return (
    <div className="flex gap-6">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0">
        <nav className="bg-slate-800 rounded-lg border border-slate-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700">
            <h2 className="text-lg font-semibold text-white">Admin</h2>
          </div>
          <div className="py-2">
            {adminNavItems.map(item => {
              const Icon = item.icon;
              const active = isActive(item);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center space-x-3 px-4 py-2.5 transition-colors ${
                    active
                      ? 'bg-primary-600/20 text-primary-400 border-r-2 border-primary-500'
                      : 'text-slate-300 hover:bg-slate-700/50 hover:text-white'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </aside>

      {/* Main Content */}
      <div className="flex-1 min-w-0">
        {children}
      </div>
    </div>
  );
}
