import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, RefreshCw, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { api } from '../services/api';

type ApiUsageSummary = {
  period: { from: string; to: string; days: number };
  totals: { units: number; requests: number };
  byProvider: Array<{ provider: string; status: string; units: number; requests: number }>;
  byService: Array<{ provider: string; service: string; action: string; status: string; units: number; requests: number }>;
  byStatus: Array<{ status: string; units: number; requests: number }>;
  recent: Array<{
    id: string;
    provider: string;
    service: string;
    action: string;
    status: string;
    units: number;
    errorMessage?: string | null;
    createdAt: string;
  }>;
};

export default function Settings() {
  const [settings, setSettings] = useState({
    maxNearbyMinutes: 90,
    suggestionWindowDays: 3,
    costPerKm: 2.4,
    averageHotelCost: 320,
    averageCarCost: 210,
    googleCalendarId: 'primary',
    googleMapsApiKey: '',
    notificationEmails: ''
  });
  const [sla, setSla] = useState({ hours: 6, autoCancel: false });
  const [resetConfirmation, setResetConfirmation] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState('');
  const [apiUsage, setApiUsage] = useState<ApiUsageSummary | null>(null);
  const [apiUsageDays, setApiUsageDays] = useState(30);
  const [apiUsageLoading, setApiUsageLoading] = useState(false);

  useEffect(() => {
    api<typeof settings>('/settings').then((data) => setSettings({ ...settings, ...data })).catch(() => undefined);
    api<typeof sla>('/settings/sla').then((data) => setSla(data)).catch(() => undefined);
    loadApiUsage(30);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await api('/settings', { method: 'PUT', body: JSON.stringify(settings) });
  }

  async function submitSla(event: React.FormEvent) {
    event.preventDefault();
    await api('/settings/sla', { method: 'PUT', body: JSON.stringify(sla) });
  }

  async function loadApiUsage(days = apiUsageDays) {
    setApiUsageLoading(true);
    try {
      const data = await api<ApiUsageSummary>(`/api-usage?days=${days}`);
      setApiUsage(data);
    } catch {
      setApiUsage(null);
    } finally {
      setApiUsageLoading(false);
    }
  }

  async function resetSystemData() {
    if (resetConfirmation !== 'REDEFINIR SISTEMA') return;
    setResetting(true);
    setResetMessage('');
    try {
      const result = await api<{ deleted: Record<string, number> }>('/appointments/system-data', {
        method: 'DELETE',
        body: JSON.stringify({ confirmation: resetConfirmation })
      });
      const total = Object.values(result.deleted).reduce((sum, count) => sum + count, 0);
      setResetMessage(`Sistema redefinido. ${total} registro(s) principal(is) removido(s).`);
      setResetConfirmation('');
    } catch (error) {
      setResetMessage(error instanceof Error ? error.message : 'Não foi possível redefinir o sistema.');
    } finally {
      setResetting(false);
    }
  }

  function formatDateTime(value: string) {
    return new Date(value).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <SettingsIcon className="h-7 w-7 text-blue-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Configurações</h1>
          <p className="text-zinc-400">Parâmetros de sugestão, custos e integrações Google</p>
        </div>
      </div>

      <Card className="bg-zinc-900/50 border-zinc-800">
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <CardTitle className="flex items-center gap-2 text-white">
              <Activity className="h-5 w-5 text-emerald-400" />
              Consumo das APIs
            </CardTitle>
            <div className="flex items-center gap-2">
              <select
                value={apiUsageDays}
                onChange={(event) => {
                  const days = Number(event.target.value);
                  setApiUsageDays(days);
                  loadApiUsage(days);
                }}
                className="h-9 rounded-md border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100"
              >
                <option value={7}>Últimos 7 dias</option>
                <option value={30}>Últimos 30 dias</option>
                <option value={90}>Últimos 90 dias</option>
              </select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={apiUsageLoading}
                onClick={() => loadApiUsage()}
                className="border-zinc-700"
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${apiUsageLoading ? 'animate-spin' : ''}`} />
                Atualizar
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
              <p className="text-sm text-zinc-400">Requisições registradas</p>
              <p className="mt-2 text-3xl font-bold text-white">{apiUsage?.totals.requests ?? 0}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
              <p className="text-sm text-zinc-400">Unidades consumidas</p>
              <p className="mt-2 text-3xl font-bold text-white">{apiUsage?.totals.units ?? 0}</p>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800">
            <div className="border-b border-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-200">Por serviço</div>
            <div className="divide-y divide-zinc-800">
              {apiUsage?.byService.length ? apiUsage.byService.slice(0, 10).map((row) => (
                <div key={`${row.provider}-${row.service}-${row.action}-${row.status}`} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[1fr_auto_auto] md:items-center">
                  <div>
                    <p className="font-semibold text-white">{row.provider} / {row.service}</p>
                    <p className="text-zinc-400">{row.action} - {row.status}</p>
                  </div>
                  <span className="rounded-full bg-blue-500/10 px-3 py-1 text-blue-200">{row.requests} req.</span>
                  <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-emerald-200">{row.units} un.</span>
                </div>
              )) : (
                <div className="px-4 py-6 text-sm text-zinc-400">Nenhum consumo registrado neste período.</div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800">
            <div className="border-b border-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-200">Últimas chamadas</div>
            <div className="divide-y divide-zinc-800">
              {apiUsage?.recent.length ? apiUsage.recent.slice(0, 8).map((row) => (
                <div key={row.id} className="grid gap-2 px-4 py-3 text-sm md:grid-cols-[1fr_auto] md:items-center">
                  <div>
                    <p className="font-semibold text-white">{row.provider} / {row.service}</p>
                    <p className="text-zinc-400">{row.action} - {row.status}{row.errorMessage ? ` - ${row.errorMessage}` : ''}</p>
                  </div>
                  <span className="text-zinc-400">{formatDateTime(row.createdAt)}</span>
                </div>
              )) : (
                <div className="px-4 py-6 text-sm text-zinc-400">Sem chamadas recentes.</div>
              )}
            </div>
          </div>

          <p className="text-xs leading-5 text-zinc-500">
            Este painel conta chamadas registradas pelo backend, como Google Maps, Drive, OpenAI e envio de e-mails.
            Chamadas feitas diretamente pelo navegador, como carregamento visual do mapa, ainda devem ser conferidas no Google Cloud.
          </p>
        </CardContent>
      </Card>

      <Card className="bg-zinc-900/50 border-zinc-800">
        <CardHeader><CardTitle className="text-white">Regras Inteligentes</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid md:grid-cols-2 gap-4">
            {Object.entries(settings).filter(([key]) => key !== 'notificationEmails').map(([key, value]) => (
              <Input key={key} placeholder={key} value={String(value)} onChange={(e) => setSettings({ ...settings, [key]: Number.isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value) })} className="bg-zinc-800/50 border-zinc-700" />
            ))}
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-zinc-200">E-mails adicionais para acompanhamento interno</label>
              <Textarea
                value={settings.notificationEmails}
                onChange={(e) => setSettings({ ...settings, notificationEmails: e.target.value })}
                placeholder="gestor@empresa.com.br, logística@empresa.com.br"
                className="min-h-24 bg-zinc-800/50 border-zinc-700"
              />
              <p className="text-xs text-zinc-400">
                O técnico e o cliente recebem mensagens próprias automaticamente. Aqui entram somente gestores e equipes internas; separe por vírgula ou por linha.
              </p>
            </div>
            <Button className="md:col-span-2 bg-blue-500 hover:bg-blue-600">Salvar Configurações</Button>
          </form>
        </CardContent>
      </Card>

      <Card className="bg-zinc-900/50 border-zinc-800">
        <CardHeader><CardTitle className="text-white">SLA de Confirmação</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submitSla} className="grid md:grid-cols-2 gap-4">
            <Input
              type="number"
              min={1}
              max={168}
              placeholder="Horas para alerta"
              value={String(sla.hours)}
              onChange={(e) => setSla({ ...sla, hours: Number(e.target.value) || 1 })}
              className="bg-zinc-800/50 border-zinc-700"
            />
            <select
              value={sla.autoCancel ? '1' : '0'}
              onChange={(e) => setSla({ ...sla, autoCancel: e.target.value === '1' })}
              className="h-10 rounded-md border border-zinc-700 bg-zinc-800/50 px-3 text-zinc-100"
            >
              <option value="0">Somente notificar (sem cancelar)</option>
              <option value="1">Notificar e cancelar automaticamente</option>
            </select>
            <Button className="md:col-span-2 bg-blue-500 hover:bg-blue-600">Salvar SLA</Button>
          </form>
        </CardContent>
      </Card>

      <Card className="border-red-500/40 bg-red-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-400">
            <AlertTriangle className="h-5 w-5" /> Redefinir dados de teste
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-6 text-zinc-300">
            Apaga agendamentos, clientes, técnicos, veículos, hotéis, notificações, relatórios e todos os usuários de teste.
            Somente sua conta de administrador será mantida. Os arquivos existentes no Google Drive não serão excluídos.
          </p>
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
            Esta ação é definitiva e não pode ser desfeita.
          </div>
          <label className="block space-y-2">
            <span className="text-sm text-zinc-300">Digite <strong>REDEFINIR SISTEMA</strong> para confirmar</span>
            <Input
              value={resetConfirmation}
              onChange={(event) => setResetConfirmation(event.target.value)}
              placeholder="REDEFINIR SISTEMA"
              className="border-red-500/40 bg-zinc-950"
            />
          </label>
          <Button
            type="button"
            variant="destructive"
            disabled={resetConfirmation !== 'REDEFINIR SISTEMA' || resetting}
            onClick={resetSystemData}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {resetting ? 'Redefinindo...' : 'Apagar todos os dados de teste'}
          </Button>
          {resetMessage && <p className="text-sm text-zinc-300">{resetMessage}</p>}
        </CardContent>
      </Card>
    </div>
  );
}