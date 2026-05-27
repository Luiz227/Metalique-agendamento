import { useEffect, useState } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { api } from '../services/api';

export default function Settings() {
  const [settings, setSettings] = useState({
    maxNearbyMinutes: 90,
    suggestionWindowDays: 3,
    costPerKm: 2.4,
    averageHotelCost: 320,
    averageCarCost: 210,
    googleCalendarId: 'primary',
    googleMapsApiKey: ''
  });
  const [sla, setSla] = useState({ hours: 6, autoCancel: false });

  useEffect(() => {
    api<typeof settings>('/settings').then((data) => setSettings({ ...settings, ...data })).catch(() => undefined);
    api<typeof sla>('/settings/sla').then((data) => setSla(data)).catch(() => undefined);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await api('/settings', { method: 'PUT', body: JSON.stringify(settings) });
  }

  async function submitSla(event: React.FormEvent) {
    event.preventDefault();
    await api('/settings/sla', { method: 'PUT', body: JSON.stringify(sla) });
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
        <CardHeader><CardTitle className="text-white">Regras Inteligentes</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid md:grid-cols-2 gap-4">
            {Object.entries(settings).map(([key, value]) => (
              <Input key={key} placeholder={key} value={String(value)} onChange={(e) => setSettings({ ...settings, [key]: Number.isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value) })} className="bg-zinc-800/50 border-zinc-700" />
            ))}
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
    </div>
  );
}
