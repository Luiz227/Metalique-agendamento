import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { ApiError, api, connectRealtime } from '../services/api';
import type { Appointment } from '../services/types';
import { statusLabel } from '../services/types';

type KanbanColumn = {
  key: 'draft' | 'pending' | 'ready' | 'critical';
  title: string;
  tone: string;
};

const columns: KanbanColumn[] = [
  { key: 'draft', title: 'Em preenchimento', tone: 'border-zinc-500' },
  { key: 'pending', title: 'Pendente de confirmação', tone: 'border-amber-500' },
  { key: 'ready', title: 'Pronto', tone: 'border-green-500' },
  { key: 'critical', title: 'Visita finalizada', tone: 'border-blue-500' }
];

const checklistLabels: Record<string, string> = {
  clientConfirmed: 'Cliente confirmado',
  contactConfirmed: 'Contato confirmado',
  addressConfirmed: 'Endereço confirmado',
  serviceTypeConfirmed: 'Tipo de serviço confirmado',
  technicianSelected: 'Tecnico selecionado',
  technicianAvailability: 'Disponibilidade do técnico',
  dateTimeConfirmed: 'Data e horário confirmados',
  hotelNeedChecked: 'Necessidade de hotel conferida',
  transportNeedChecked: 'Necessidade de transporte conferida',
  osChecked: 'OS conferida',
  clientChecklistChecked: 'Checklist do cliente conferido'
};

function missingItems(appointment: Appointment): string[] {
  const list: string[] = [];
  const checklist = appointment.schedulingChecklist;
  if (!appointment.city?.trim()) list.push('Cidade');
  if (!appointment.fullAddress?.trim()) list.push('Endereço completo');
  if (!appointment.problemDescription?.trim()) list.push('Descricao do serviço');
  if (!appointment.startTime) list.push('Data/hora');

  for (const [key, label] of Object.entries(checklistLabels)) {
    if (!checklist || !checklist[key as keyof NonNullable<Appointment['schedulingChecklist']>]) list.push(label);
  }
  return list;
}

function wasFinishedByTechnician(appointment: Appointment) {
  if (appointment.status === 'READY') return false;
  return (appointment.statusLogs ?? []).some((log) => log.status === 'COMPLETED_SUCCESS' || log.status === 'COMPLETED_PARTIAL');
}

function columnOf(appointment: Appointment): KanbanColumn['key'] {
  if (appointment.status === 'READY') return 'ready';
  if (appointment.status === 'CRITICAL' || wasFinishedByTechnician(appointment)) return 'critical';

  const checklist = appointment.schedulingChecklist;
  const hasCoreDataMissing =
    !appointment.city?.trim() ||
    appointment.city === 'A definir' ||
    !appointment.fullAddress?.trim() ||
    !appointment.serviceType?.trim() ||
    appointment.serviceType === 'Pendente definicao' ||
    !appointment.problemDescription?.trim() ||
    appointment.problemDescription === 'Pendente descricao do servi??o' ||
    !appointment.technicianId ||
    !appointment.startTime;

  const hasChecklistPending = Object.keys(checklistLabels).some((key) => {
    if (!checklist) return true;
    return !checklist[key as keyof NonNullable<Appointment['schedulingChecklist']>];
  });

  if (hasCoreDataMissing) return 'draft';
  if (hasChecklistPending) return 'pending';
  return 'pending';
}

export default function Kanban() {
  const [items, setItems] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(showLoading = false) {
    if (showLoading) setLoading(true);
    setError('');
    try {
      const data = await api<Appointment[]>('/appointments');
      setItems((current) => (JSON.stringify(current) === JSON.stringify(data) ? current : data));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao carregar kanban');
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    load(true);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => load(false), 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const disconnect = connectRealtime(() => load(false));
    return () => disconnect();
  }, []);

  const grouped = useMemo(
    () =>
      columns.reduce<Record<KanbanColumn['key'], Appointment[]>>(
        (acc, col) => {
          acc[col.key] = items.filter((item) => columnOf(item) === col.key);
          return acc;
        },
        { draft: [], pending: [], ready: [], critical: [] }
      ),
    [items]
  );

  async function remind(appointmentId: string) {
    try {
      const response = await api<{ ok: boolean; message: string }>(`/appointments/${appointmentId}/remind-missing`, { method: 'POST' });
      toast.success(response.message);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao enviar lembrete');
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Kanban de Agendamentos</h1>
          <p className="text-muted-foreground">Acompanhe status, pendências e lembretes para finalização.</p>
        </div>
        <Button variant="outline" onClick={() => load(true)}>Atualizar</Button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
      {loading && <p className="text-sm text-muted-foreground">Carregando...</p>}

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {columns.map((column) => (
          <Card key={column.key} className={`border ${column.tone}`}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                {column.title}
                <Badge variant="secondary">{grouped[column.key].length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {grouped[column.key].length === 0 && <p className="text-xs text-muted-foreground">Sem agendamentos nesta coluna.</p>}

              {grouped[column.key].map((appointment) => {
                const missing = missingItems(appointment);
                return (
                  <div key={appointment.id} className="rounded-lg border bg-card p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold truncate">{appointment.client?.name || 'Cliente sem nome'}</p>
                      <Badge variant="outline" className="text-[10px]">{statusLabel(appointment.status)}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{appointment.city}</p>
                    <p className="text-xs text-muted-foreground">Técnico: {appointment.technician?.name || 'Não definido'}</p>

                    {missing.length > 0 ? (
                      <div className="text-xs text-amber-700 dark:text-amber-300">
                        <p className="font-medium mb-1">Faltando:</p>
                        <p>{missing.slice(0, 4).join(' • ')}{missing.length > 4 ? ' ...' : ''}</p>
                      </div>
                    ) : (
                      <p className="text-xs text-green-600 dark:text-green-400">Checklist completo.</p>
                    )}
                    {wasFinishedByTechnician(appointment) && (
                      <p className="text-xs text-blue-600 dark:text-blue-400">Visita finalizada pelo técnico.</p>
                    )}

                    <div className="flex gap-2 pt-1">
                      <Link to={`/appointments/${appointment.id}`} className="flex-1">
                        <Button size="sm" variant="outline" className="w-full">Abrir</Button>
                      </Link>
                      <Button size="sm" onClick={() => remind(appointment.id)} className="bg-blue-600 hover:bg-blue-700">Lembrar</Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
