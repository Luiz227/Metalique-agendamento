import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Map,
  Calendar,
  DollarSign,
  CheckCircle,
  Users,
  Car,
  Bell,
  Menu,
  X,
  Shield,
  BarChart3,
  LogOut,
  Settings,
  Sun,
  Moon,
  Columns3,
  ClipboardList
} from 'lucide-react';
import { Button } from './ui/button';
import { useEffect, useState } from 'react';
import Logo from './Logo';
import { clearSession, getUser, type ApiUser } from '../services/api';

type NavigationItem = {
  name: string;
  href: string;
  icon: typeof LayoutDashboard;
  roles: ApiUser['role'][];
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('sp-theme') as 'dark' | 'light') || 'light');
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isMobileWeb, setIsMobileWeb] = useState(false);
  const user = getUser();

  useEffect(() => {
    const html = document.documentElement;
    html.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('sp-theme', theme);
  }, [theme]);

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    const html = document.documentElement;
    html.classList.toggle('dark', next === 'dark');
    localStorage.setItem('sp-theme', next);
  }

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1024px)');
    const update = () => setIsMobileWeb(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const handler = (evt: Event) => {
      const custom = evt as CustomEvent<BeforeInstallPromptEvent>;
      if (custom.detail) setInstallPrompt(custom.detail);
    };
    window.addEventListener('pwa-install-available', handler as EventListener);
    return () => window.removeEventListener('pwa-install-available', handler as EventListener);
  }, []);

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice.catch(() => undefined);
    setInstallPrompt(null);
  }

  const navigation: NavigationItem[] = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ['ADMIN'] },
    { name: 'Kanban', href: '/kanban', icon: Columns3, roles: ['ADMIN'] },
    { name: 'Mapa Operacional', href: '/map', icon: Map, roles: ['ADMIN', 'LOGISTICS', 'SALES'] },
    { name: 'Agenda', href: '/schedule', icon: Calendar, roles: ['ADMIN', 'LOGISTICS', 'SALES'] },
    { name: 'Central Agend.', href: '/appointments/manage', icon: ClipboardList, roles: ['ADMIN', 'LOGISTICS', 'SALES'] },
    { name: 'Financeiro', href: '/financial', icon: DollarSign, roles: ['ADMIN'] },
    { name: 'Validacao', href: '/validation', icon: CheckCircle, roles: ['ADMIN', 'VALIDATOR'] },
    { name: 'Meus Atendimentos', href: '/technician', icon: Calendar, roles: ['TECHNICIAN'] },
    { name: 'Calendario', href: '/technician/calendar', icon: Calendar, roles: ['TECHNICIAN'] },
    { name: 'Tecnicos', href: '/technicians', icon: Users, roles: ['ADMIN', 'LOGISTICS', 'SALES'] },
    { name: 'Usuarios', href: '/users', icon: Shield, roles: ['ADMIN'] },
    { name: 'Veiculos', href: '/vehicles', icon: Car, roles: ['ADMIN', 'LOGISTICS'] },
    { name: 'Relatorios', href: '/reports', icon: BarChart3, roles: ['ADMIN', 'LOGISTICS'] },
    { name: 'Configuracoes', href: '/settings', icon: Settings, roles: ['ADMIN'] }
  ];

  const visibleNavigation = navigation.filter((item) => !user?.role || item.roles.includes(user.role));

  return (
    <div className="flex h-screen bg-background text-foreground">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-card border-r border-border transform transition-transform duration-300 ease-in-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-between h-16 px-6 border-b border-border">
            <div className="flex items-center gap-3">
              <Logo size="sm" />
            </div>
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(false)}>
              <X className="h-5 w-5" />
            </Button>
          </div>

          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
            {visibleNavigation.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.href;
              return (
                <Link
                  key={item.name}
                  to={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${isActive ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-accent'}`}
                >
                  <Icon className="h-5 w-5 flex-shrink-0" />
                  <span>{item.name}</span>
                </Link>
              );
            })}
          </nav>

          <div className="p-4 border-t border-border">
            <div className="flex items-center gap-3 px-3 py-2">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-500" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user?.name ?? 'Usuario'}</p>
                <p className="text-xs text-muted-foreground truncate">{user?.email ?? 'sem email'}</p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              className="mt-2 w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
              onClick={() => {
                clearSession();
                navigate('/login', { replace: true });
              }}
            >
              <LogOut className="h-4 w-4" />
              Sair
            </Button>
          </div>
        </div>
      </aside>

      <div className="flex flex-col flex-1 overflow-hidden">
        <header className="h-16 bg-card/80 border-b border-border backdrop-blur-sm flex items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
              <Menu className="h-5 w-5" />
            </Button>
            <h1 className="text-xl font-semibold">
              {navigation.find((item) => item.href === location.pathname)?.name || 'Agenda Metalique'}
            </h1>
          </div>

          <div className="flex items-center gap-3">
            {installPrompt && isMobileWeb && user?.role === 'TECHNICIAN' && (
              <Button variant="outline" size="sm" onClick={installApp}>
                Instalar app
              </Button>
            )}
            <Button variant="ghost" size="icon" onClick={toggleTheme} title="Alternar tema">
              {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
            {user?.role === 'ADMIN' && (
              <Link to="/notifications">
                <Button variant="ghost" size="icon" className="relative">
                  <Bell className="h-5 w-5" />
                </Button>
              </Link>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-auto bg-background">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
