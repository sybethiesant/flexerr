import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../App';
import {
  LayoutDashboard,
  Compass,
  Heart,
  Clock,
  Settings,
  FileText,
  LogOut,
  Film,
  ChevronDown,
  Shield,
  Users,
  ListChecks,
  Trash2,
  Timer
} from 'lucide-react';

const navItems = [
  { path: '/', label: 'Home', icon: LayoutDashboard },
  { path: '/discover', label: 'Discover', icon: Compass },
  { path: '/watchlist', label: 'Watchlist', icon: Heart },
  { path: '/requests', label: 'Requests', icon: Clock },
  { path: '/leaving-soon', label: 'Leaving Soon', icon: Timer },
];

const adminLink = { path: '/admin', label: 'Admin', icon: Shield };

export default function Navbar() {
  const location = useLocation();
  const { user, logout } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <nav className="bg-slate-800 border-b border-slate-700 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center space-x-2">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center">
              <Film className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold text-white">Flexerr</span>
          </Link>

          {/* Nav Links */}
          <div className="hidden md:flex items-center space-x-1">
            {navItems.filter(item => !item.adminOnly || user?.is_admin).map(item => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={isActive(item.path)
                    ? 'flex items-center space-x-2 px-3 py-2 rounded-lg transition-colors bg-primary-600 text-white'
                    : 'flex items-center space-x-2 px-3 py-2 rounded-lg transition-colors text-slate-300 hover:bg-slate-700 hover:text-white'
                  }
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </Link>
              );
            })}

            {/* Admin Link */}
            {user?.is_admin && (
              <>
                <div className="w-px h-6 bg-slate-600 mx-2" />
                <Link
                  to={adminLink.path}
                  className={location.pathname.startsWith('/admin')
                    ? 'flex items-center space-x-2 px-3 py-2 rounded-lg transition-colors bg-primary-600 text-white'
                    : 'flex items-center space-x-2 px-3 py-2 rounded-lg transition-colors text-slate-300 hover:bg-slate-700 hover:text-white'
                  }
                >
                  <Shield className="h-4 w-4" />
                  <span>{adminLink.label}</span>
                </Link>
              </>
            )}
          </div>

          {/* User Menu */}
          <div className="relative">
            <button
              onClick={() => setShowUserMenu(!showUserMenu)}
              className="flex items-center space-x-2 px-3 py-2 rounded-lg hover:bg-slate-700 transition-colors"
            >
              {user?.thumb ? (
                <img
                  src={user.thumb}
                  alt={user.username}
                  className="w-8 h-8 rounded-full"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center text-white font-medium">
                  {user?.username?.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="text-white hidden sm:block">{user?.username}</span>
              {user?.is_admin && (
                <Shield className="h-4 w-4 text-yellow-500" />
              )}
              <ChevronDown className="h-4 w-4 text-slate-400" />
            </button>

            {showUserMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowUserMenu(false)}
                />
                <div className="absolute right-0 mt-2 w-48 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-20 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-700">
                    <p className="text-white font-medium truncate">{user?.username}</p>
                    <p className="text-sm text-slate-400 truncate">{user?.email}</p>
                    {user?.is_admin && (
                      <span className="inline-flex items-center mt-1 px-2 py-0.5 rounded text-xs bg-yellow-500/20 text-yellow-400">
                        <Shield className="h-3 w-3 mr-1" />
                        Admin
                      </span>
                    )}
                  </div>

                  {/* Mobile nav items */}
                  <div className="md:hidden py-2 border-b border-slate-700">
                    {navItems.filter(item => !item.adminOnly || user?.is_admin).map(item => {
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.path}
                          to={item.path}
                          onClick={() => setShowUserMenu(false)}
                          className={isActive(item.path)
                            ? 'flex items-center space-x-2 px-4 py-2 text-primary-400 bg-slate-700/50'
                            : 'flex items-center space-x-2 px-4 py-2 text-slate-300 hover:bg-slate-700'
                          }
                        >
                          <Icon className="h-4 w-4" />
                          <span>{item.label}</span>
                        </Link>
                      );
                    })}
                    {user?.is_admin && (
                      <Link
                        to="/admin"
                        onClick={() => setShowUserMenu(false)}
                        className={location.pathname.startsWith('/admin')
                          ? 'flex items-center space-x-2 px-4 py-2 text-primary-400 bg-slate-700/50'
                          : 'flex items-center space-x-2 px-4 py-2 text-slate-300 hover:bg-slate-700'
                        }
                      >
                        <Shield className="h-4 w-4" />
                        <span>Admin</span>
                      </Link>
                    )}
                  </div>

                  <button
                    onClick={() => {
                      setShowUserMenu(false);
                      logout();
                    }}
                    className="w-full flex items-center space-x-2 px-4 py-3 text-slate-300 hover:bg-slate-700 hover:text-white"
                  >
                    <LogOut className="h-4 w-4" />
                    <span>Sign out</span>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
