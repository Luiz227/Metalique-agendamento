import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, AlertCircle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { ApiError, api, connectRealtime } from '../services/api';
import type { Appointment, Client } from '../services/types';
import { formatDate, formatTime, money, statusLabel } from '../services/types';

type QuickForm = {
  companyName: string;
  cnpj: string;
  address: string;
  city: string;
  daysOut: string;
};

const initialForm: QuickForm = {
  companyName: '',
  cnpj: '',
  address: '',
  city: '',
  daysOut: '1'
};

const checklistLabels: Record<string, string> = {
  clientConfirmed: 'Cliente confirmado',
  contactConfirmed: 'Contato confirmado',
  addressConfirmed: 'Endereco confirmado',
  serviceTypeConfirmed: 'Tipo de servico confirmado',
  technicianSelected: 'Tecnico selecionado',
  technicianAvailability: 'Disponibilidade do tecnico',
  dateTimeConfirmed: 'Data e horario confirmados',
  hotelNeedChecked: 'Necessidade de hotel conferida',
  transportNeedChecked: 'Necessidade de transporte conferida',
  osChecked: 'OS conferida',
  clientChecklistChecked: 'Checklist do cliente conferido'
};

function missingItems(appointment: Appointment): string[] {
  const list: string[] = [];
  const checklist = appointment.schedulingChecklist;
  if (!appointment.city?.trim() || appointment.city === 'A definir') list.push('Cidade');
  if (!appointment.fullAddress?.trim()) list.push('Endereco completo');
  if (!appointment.problemDescription?.trim() || appointment.problemDescription === 'Pendente descricao do servico') list.push('Descricao do servico');
  if (!appointment.technicianId) list.push('Tecnico');
  for (const [key, label] of Object.entries(checklistLabels)) {
    if (!checklist || !checklist[key as keyof NonNullable<Appointment['schedulingChecklist']>]) list.push(label);
  }
  return list;
}

function technicianReportText(appointment: Appointment) {
  return (
    appointment.statusLogs
      ?.filter((log) => log.status === 'COMPLETED_SUCCESS' || log.status === 'COMPLETED_PARTIAL')
      .map((log) => log.observation?.trim())
      .find(Boolean) ?? ''
  );
}

export default function AppointmentsManager() {
  const [form, setForm] = useState<QuickForm>(initialForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFinished, setShowFinished] = useState(false);

  async function load(showSpinner = false) {
    if (showSpinner) setLoading(true);
    try {
      const data = await api<Appointment[]>('/appointments');
      setItems(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao carregar agendamentos');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load(true);
  }, []);

  useEffect(() => {
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const disconnect = connectRealtime(() => load());
    return () => disconnect();
  }, []);

  const pending = useMemo(
    () =>
      items
        .map((item) => ({ item, missing: missingItems(item) }))
        .filter((row) => row.item.status !== 'CRITICAL')
        .filter((row) => row.item.status !== 'READY' || row.missing.length > 0)
        .sort((a, b) => new Date(b.item.date).getTime() - new Date(a.item.date).getTime()),
    [items]
  );

  const finished = useMemo(
    () =>
      items
        .filter((item) => item.status === 'CRITICAL')
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [items]
  );

  async function createClient() {
    return api<Client>('/clients', {
      method: 'POST',
      body: JSON.stringify({
        name: form.companyName,
        city: form.city || 'A definir',
        address: form.address,
        notes: `CNPJ: ${form.cnpj}`
      })
    });
  }

  async function createDraftAppointment() {
    const client = await createClient();
    const today = new Date();
    const end = new Date(today.getTime() + 2 * 60 * 60 * 1000);
    return api<Appointment>('/appointments', {
      method: 'POST',
      body: JSON.stringify({
        clientId: client.id,
        city: form.city || 'A definir',
        fullAddress: form.address,
        serviceType: 'Pendente definicao',
        problemDescription: 'Pendente descricao do servico',
        date: new Date(`${today.toISOString().slice(0, 10)}T12:00:00`).toISOString(),
        startTime: today.toISOString(),
        endTime: end.toISOString(),
        status: 'WAITING',
        daysOut: Number(form.daysOut || '1'),
        osNumber: '',
        clientChecklist: `CNPJ: ${form.cnpj}`,
        notes: 'Agendamento criado em preenchimento',
        schedulingChecklist: {
          clientConfirmed: false,
          contactConfirmed: false,
          addressConfirmed: false,
          serviceTypeConfirmed: false,
          technicianSelected: false,
          technicianAvailability: false,
          dateTimeConfirmed: false,
          hotelNeedChecked: false,
          transportNeedChecked: false,
          osChecked: false,
          clientChecklistChecked: false
        }
      })
    });
  }

  async function handleCreate() {
    if (!form.companyName || !form.cnpj || !form.address || Number(form.daysOut || '0') < 1) {
      setError('Preencha empresa, CNPJ, endereco e dias (minimo 1).');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const created = await createDraftAppointment();
      toast.success('Agendamento criado com sucesso em preenchimento.');
      setForm(initialForm);
      await load();
      window.location.href = `/appointments/${created.id}`;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao criar agendamento');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Central de Agendamentos</h1>
          <p className="text-muted-foreground">Crie rapido e continue preenchendo quando quiser.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Novo Agendamento Rapido</CardTitle>
        </CardHeader>
        <CardContent className="grid md:grid-cols-5 gap-3">
          <div>
            <Label>Empresa</Label>
            <Input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
          </div>
          <div>
            <Label>CNPJ</Label>
            <Input value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} />
          </div>
          <div>
            <Label>Cidade</Label>
            <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          </div>
          <div>
            <Label>Endereco</Label>
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
          <div>
            <Label>Dias do agendamento</Label>
            <Input
              type="number"
              min="1"
              value={form.daysOut}
              onChange={(e) => setForm({ ...form, daysOut: e.target.value })}
            />
          </div>
          <div className="md:col-span-4 flex items-center gap-2">
            <Button onClick={handleCreate} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
              <Plus className="h-4 w-4 mr-2" />
              {saving ? 'Criando...' : 'Criar Agendamento'}
            </Button>
            <Link to="/schedule">
              <Button variant="outline">Ir para Agenda</Button>
            </Link>
          </div>
          {error && <p className="md:col-span-4 text-sm text-red-500">{error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agendamentos com Pendencias</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && <p className="text-sm text-muted-foreground">Carregando...</p>}
          {!loading && pending.length === 0 && <p className="text-sm text-muted-foreground">Nenhum agendamento pendente.</p>}
          {pending.map(({ item, missing }) => (
            <div key={item.id} className="rounded-lg border bg-card p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">{item.client?.name ?? 'Cliente sem nome'}</p>
                  <p className="text-xs text-muted-foreground">{item.city} - {item.fullAddress}</p>
                </div>
                <Badge variant="outline">{statusLabel(item.status)}</Badge>
              </div>
              <div className="text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5" />
                <span>Faltando: {missing.slice(0, 6).join(' - ')}{missing.length > 6 ? ' ...' : ''}</span>
              </div>
              <div>
                <Link to={`/appointments/${item.id}`}>
                  <Button size="sm" variant="outline">Abrir e continuar preenchimento</Button>
                </Link>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <CardTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-blue-500" />
            Agendamentos finalizados
          </CardTitle>
          <Button variant="outline" onClick={() => setShowFinished((value) => !value)}>
            {showFinished ? 'Ocultar finalizados' : `Mostrar finalizados (${finished.length})`}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {!showFinished && (
            <p className="text-sm text-muted-foreground">
              Clique em mostrar finalizados para consultar atendimentos encerrados e o relato do tecnico.
            </p>
          )}
          {showFinished && loading && <p className="text-sm text-muted-foreground">Carregando...</p>}
          {showFinished && !loading && finished.length === 0 && <p className="text-sm text-muted-foreground">Nenhum agendamento finalizado.</p>}
          {showFinished && finished.map((item) => {
            const technicalReport = technicianReportText(item);

            return (
              <div key={item.id} className="rounded-lg border bg-card p-4 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">{item.client?.name ?? 'Cliente sem nome'}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(item.date)} as {formatTime(item.startTime)}
                      {item.osNumber ? ` - OS ${item.osNumber}` : ''}
                    </p>
                  </div>
                  <Badge variant="outline">{statusLabel(item.status)}</Badge>
                </div>

                <div className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Tecnico</p>
                    <p>{item.technician?.name ?? 'Sem tecnico vinculado'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Cidade</p>
                    <p>{item.city || 'Nao informado'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Endereco</p>
                    <p>{item.fullAddress || 'Nao informado'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Tipo de servico</p>
                    <p>{item.serviceType || 'Nao informado'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Maquina</p>
                    <p>{[item.machineName, item.machineModel].filter(Boolean).join(' - ') || 'Nao informado'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Numero de serie</p>
                    <p>{item.machineSerial || 'Nao informado'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Hospedagem</p>
                    <p>
                      {item.hasHotel
                        ? `${item.hotelName || 'Hotel informado'}${item.hotelDailyRate ? ` - ${money(item.hotelDailyRate)}` : ''}`
                        : 'Sem hospedagem'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Transporte</p>
                    <p>{item.transportMode || (item.needsTransport ? 'Necessario' : 'Nao informado')}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Periodo</p>
                    <p>{item.daysOut ?? 1} dia(s)</p>
                  </div>
                </div>

                <div className="rounded-md border bg-muted/30 p-3 text-sm">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Relato do tecnico</p>
                  <p className="whitespace-pre-wrap">{technicalReport || 'Relato nao informado.'}</p>
                </div>

                {(item.problemDescription || item.notes || item.hotelNotes) && (
                  <div className="rounded-md border bg-muted/30 p-3 text-sm">
                    {item.problemDescription && (
                      <p>
                        <span className="text-muted-foreground">Servico: </span>
                        {item.problemDescription}
                      </p>
                    )}
                    {item.notes && (
                      <p>
                        <span className="text-muted-foreground">Observacoes: </span>
                        {item.notes}
                      </p>
                    )}
                    {item.hotelNotes && (
                      <p>
                        <span className="text-muted-foreground">Hotel: </span>
                        {item.hotelNotes}
                      </p>
                    )}
                  </div>
                )}

                <div>
                  <Link to={`/appointments/${item.id}`}>
                    <Button size="sm" variant="outline">Visualizar campos do agendamento</Button>
                  </Link>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
