import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar,
  Users,
  TrendingUp,
  AlertTriangle,
  DollarSign,
  MapPin,
  CheckCircle2,
  ArrowRight,
  Sparkles
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Progress } from '../components/ui/progress';
import { ApiError, api } from '../services/api';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';

type DashboardData = {
  todayCount: number;
  weekCount: number;
  critical: number;
  awaitingValidation: number;
  techniciansInField: number;
  techniciansAvailable: number;
  hotelsPending: number;
  transportsPending: number;
  osPending: number;
  openSuggestions: number;
  estimatedSavings: number;
  weekPlanned: number;
  weekReal: number;
  weekDifference: number;
  monthPlanned: number;
  monthReal: number;
  alerts: Array<{ type: string; message: string; severity: 'high' | 'medium' | 'low' }>;
  charts: {
    appointmentsByWeekday: Array<{ label: string; total: number }>;
    status: Array<{ label: 'CRITICAL' | 'WAITING' | 'READY'; total: number }>;
    technicianUsage: Array<{ label: string; total: number }>;
  };
};

const statusLabels: Record<string, string> = {
  READY: 'Pronto',
  WAITING: 'Aguardando',
  CRITICAL: 'Crítico'
};

const statusColors: Record<string, string> = {
  READY: '#10b981',
  WAITING: '#f59e0b',
  CRITICAL: '#ef4444'
};

const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0
});

const emptyDashboard: DashboardData = {
  todayCount: 0,
  weekCount: 0,
  critical: 0,
  awaitingValidation: 0,
  techniciansInField: 0,
  techniciansAvailable: 0,
  hotelsPending: 0,
  transportsPending: 0,
  osPending: 0,
  openSuggestions: 0,
  estimatedSavings: 0,
  weekPlanned: 0,
  weekReal: 0,
  weekDifference: 0,
  monthPlanned: 0,
  monthReal: 0,
  alerts: [],
  charts: {
    appointmentsByWeekday: [],
    status: [
      { label: 'READY', total: 0 },
      { label: 'WAITING', total: 0 },
      { label: 'CRITICAL', total: 0 }
    ],
    technicianUsage: []
  }
};

export default function Dashboard() {
  const [dashboard, setDashboard] = useState<DashboardData>(emptyDashboard);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      try {
        const data = await api<DashboardData>('/dashboard');
        if (active) setDashboard(data);
      } catch (err) {
        if (active) setError(err instanceof ApiError ? err.message : 'Falha ao carregar o dashboard');
      } finally {
        if (active) setLoading(false);
      }
    }

    loadDashboard();
    return () => {
      active = false;
    };
  }, []);

  const quickStats = useMemo(
    () => [
      { label: 'Agendamentos Hoje', value: dashboard.todayCount, icon: Calendar, color: 'text-blue-400', bg: 'bg-blue-500/10' },
      { label: 'Agendamentos Semana', value: dashboard.weekCount, icon: Calendar, color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
      { label: 'Técnicos em Campo', value: dashboard.techniciansInField, icon: Users, color: 'text-green-400', bg: 'bg-green-500/10' },
      { label: 'Pendências Críticas', value: dashboard.critical, icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-500/10' },
      { label: 'Gastos Previstos', value: money.format(dashboard.weekPlanned), icon: DollarSign, color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
      { label: 'Gastos Reais', value: money.format(dashboard.weekReal), icon: TrendingUp, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
      { label: 'Economia Gerada', value: money.format(dashboard.estimatedSavings), icon: TrendingUp, color: 'text-purple-400', bg: 'bg-purple-500/10' },
      { label: 'Sugestões Abertas', value: dashboard.openSuggestions, icon: Sparkles, color: 'text-violet-400', bg: 'bg-violet-500/10' }
    ],
    [dashboard]
  );

  const weeklyAppointments = dashboard.charts.appointmentsByWeekday.map((item) => ({
    dia: item.label,
    atendimentos: item.total
  }));

  const statusDistribution = dashboard.charts.status.map((item) => ({
    name: statusLabels[item.label] ?? item.label,
    value: item.total,
    color: statusColors[item.label] ?? '#71717a'
  }));

  const totalStatus = statusDistribution.reduce((sum, item) => sum + item.value, 0);
  const maxTechnicianUsage = Math.max(...dashboard.charts.technicianUsage.map((item) => item.total), 1);

  return (
    <div className="p-6 space-y-6">
      {error && (
        <Card className="bg-red-500/10 border-red-500/30">
          <CardContent className="p-4 text-sm text-red-200">{error}</CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
        {quickStats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label} className="bg-zinc-900/50 border-zinc-800">
              <CardContent className="p-4">
                <div className={`w-10 h-10 rounded-lg ${stat.bg} flex items-center justify-center mb-3`}>
                  <Icon className={`h-5 w-5 ${stat.color}`} />
                </div>
                <div className="text-2xl font-bold text-white mb-1">{loading ? '...' : stat.value}</div>
                <div className="text-xs text-zinc-400">{stat.label}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Calendar className="h-5 w-5 text-blue-400" />
                Atendimentos da Semana
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={weeklyAppointments}>
                  <defs>
                    <linearGradient id="colorAtendimentos" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="dia" stroke="#71717a" />
                  <YAxis stroke="#71717a" allowDecimals={false} />
                  <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }} labelStyle={{ color: '#fff' }} />
                  <Legend />
                  <Area type="monotone" dataKey="atendimentos" stroke="#06b6d4" fillOpacity={1} fill="url(#colorAtendimentos)" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Users className="h-5 w-5 text-cyan-400" />
                Atendimentos por Técnico
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dashboard.charts.technicianUsage.length === 0 ? (
                <div className="h-[300px] flex items-center justify-center text-sm text-zinc-500">
                  Nenhum atendimento vinculado a técnico ainda.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={dashboard.charts.technicianUsage}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                    <XAxis dataKey="label" stroke="#71717a" />
                    <YAxis stroke="#71717a" allowDecimals={false} />
                    <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }} labelStyle={{ color: '#fff' }} />
                    <Bar dataKey="total" fill="#06b6d4" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <MapPin className="h-5 w-5 text-purple-400" />
                Uso dos Técnicos
              </CardTitle>
            </CardHeader>
            <CardContent>
              {dashboard.charts.technicianUsage.length === 0 ? (
                <div className="py-8 text-sm text-zinc-500">Cadastre técnicos e atendimentos para visualizar esta análise.</div>
              ) : (
                <div className="space-y-3">
                  {dashboard.charts.technicianUsage.map((item) => (
                    <div key={item.label} className="flex items-center gap-3">
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm text-white">{item.label}</span>
                          <span className="text-sm text-zinc-400">{item.total} atendimentos</span>
                        </div>
                        <Progress value={(item.total / maxTechnicianUsage) * 100} className="h-2" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-400" />
                Status Operacional
              </CardTitle>
            </CardHeader>
            <CardContent>
              {totalStatus === 0 ? (
                <div className="h-[200px] flex items-center justify-center text-sm text-zinc-500">
                  Nenhum atendimento cadastrado.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={statusDistribution} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                      {statusDistribution.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
              <div className="space-y-2 mt-4">
                {statusDistribution.map((status) => (
                  <div key={status.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: status.color }} />
                      <span className="text-sm text-zinc-300">{status.name}</span>
                    </div>
                    <span className="text-sm font-medium text-white">{status.value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-400" />
                Alertas Críticos
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {dashboard.alerts.length === 0 ? (
                <div className="py-6 text-sm text-zinc-500">Nenhum alerta operacional no momento.</div>
              ) : (
                dashboard.alerts.map((alert, index) => (
                  <div key={`${alert.type}-${index}`} className={`p-3 rounded-lg border ${alert.severity === 'high' ? 'bg-red-500/10 border-red-500/20' : 'bg-yellow-500/10 border-yellow-500/20'}`}>
                    <p className="text-sm text-white">{alert.message}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/50 border-zinc-800 border-purple-500/20">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-purple-400" />
                Sugestões Inteligentes
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="text-sm font-medium text-white">Sugestões abertas</h4>
                  <span className="text-xs font-medium text-green-400">{dashboard.openSuggestions}</span>
                </div>
                <p className="text-xs text-zinc-400">
                  As sugestões serão criadas automaticamente quando houver atendimentos próximos no banco.
                </p>
              </div>
              <Link to="/suggestions">
                <Button variant="outline" className="w-full border-purple-500/20 text-purple-400 hover:bg-purple-500/10">
                  Ver sugestões
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardHeader>
              <CardTitle className="text-white text-sm">Ações Rápidas</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link to="/appointments/new">
                <Button className="w-full bg-blue-500 hover:bg-blue-600">Novo Agendamento</Button>
              </Link>
              <Link to="/map">
                <Button variant="outline" className="w-full border-zinc-700 text-zinc-300 hover:bg-zinc-800">
                  Ver Mapa Operacional
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
