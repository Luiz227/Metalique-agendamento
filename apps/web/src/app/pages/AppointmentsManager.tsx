import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, ClipboardPenLine, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { ApiError, api, connectRealtime } from '../services/api';
import { createAppointmentDraft } from '../services/appointmentDraft';
import type { Appointment } from '../services/types';
import { formatDate, formatTime, money, statusLabel } from '../services/types';

const checklistLabels: Record<string, string> = {
  clientConfirmed: 'Cliente confirmado',
  contactConfirmed: 'Contato confirmado',
  addressConfirmed: 'Endereço confirmado',
  serviceTypeConfirmed: 'Tipo de serviço confirmado',
  technicianSelected: 'Técnico selecionado',
  technicianAvailability: 'Disponibilidade do técnico',
  dateTimeConfirmed: 'Data e horário confirmados',
  hotelNeedChecked: 'Necessidade de hotel conferida',
  transportNeedChecked: 'Necessidade de transporte conferida',
  osChecked: 'OS conferida',
  clientChecklistChecked: 'Checklist do cliente conferido'
};

function missingItems(appointment: Appointment): string[] {
  if (appointment.status === 'COMPLETED' || appointment.status === 'CRITICAL') return [];

  const list: string[] = [];
  const checklist = appointment.schedulingChecklist;
  if (!appointment.city?.trim() || appointment.city === 'A definir') list.push('Cidade');
  if (!appointment.fullAddress?.trim()) list.push('Endereço completo');
  if (!appointment.problemDescription?.trim() || appointment.problemDescription === 'Pendente descricao do servico') list.push('Descrição do serviço');
  if (!appointment.technicianId) list.push('Técnico');
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
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [items, setItems] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFinished, setShowFinished] = useState(false);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deletingAll, setDeletingAll] = useState(false);

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
        .filter((row) => row.item.status !== 'CRITICAL' && row.item.status !== 'COMPLETED')
        .filter((row) => row.item.status !== 'READY' || row.missing.length > 0)
        .sort((a, b) => new Date(b.item.date).getTime() - new Date(a.item.date).getTime()),
    [items]
  );

  const finished = useMemo(
    () =>
      items
        .filter((item) => item.status === 'CRITICAL' || item.status === 'COMPLETED')
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    [items]
  );

  async function handleReopen(id: string) {
    try {
      await api(`/appointments/${id}/reopen`, { method: 'POST' });
      toast.success('Agendamento reaberto e movido para Pronto.');
      await load();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Erro ao reabrir agendamento');
    }
  }

  async function handleCreateAppointment() {
    setCreatingDraft(true);
    setError('');
    try {
      const draft = await createAppointmentDraft();
      toast.success('Rascunho criado. Abrindo o formulario oficial completo.');
      navigate(`/appointments/${draft.id}?editing=1&source=create`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível criar o rascunho do agendamento.');
      toast.error('Erro ao abrir a tela completa de criação.');
    } finally {
      setCreatingDraft(false);
    }
  }

  async function handleDeleteAll() {
    if (deleteConfirmation !== 'EXCLUIR TODOS') return;
    setDeletingAll(true);
    try {
      const result = await api<{ deleted: number }>('/appointments', {
        method: 'DELETE',
        body: JSON.stringify({ confirmation: deleteConfirmation })
      });
      setItems([]);
      setDeleteAllOpen(false);
      setDeleteConfirmation('');
      toast.success(`${result.deleted} agendamento(s) excluido(s).`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível excluir os agendamentos.');
    } finally {
      setDeletingAll(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Central de Agendamentos</h1>
          <p className="text-muted-foreground">
            Agora a criação comeca direto no formulario completo, sem duplicar preenchimento entre duas telas.
          </p>
        </div>
        <Button variant="destructive" onClick={() => setDeleteAllOpen(true)} disabled={!items.length}>
          <Trash2 className="mr-2 h-4 w-4" />
          Excluir todos
        </Button>
      </div>

      <Dialog open={deleteAllOpen} onOpenChange={(open) => {
        setDeleteAllOpen(open);
        if (!open) setDeleteConfirmation('');
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir todos os agendamentos?</DialogTitle>
            <DialogDescription>
              Está ação exclui permanentemente {items.length} agendamento(s) e seus registros relacionados. Os arquivos existentes no Google Drive serão preservados.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm">Digite <strong>EXCLUIR TODOS</strong> para confirmar:</p>
            <Input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteAllOpen(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDeleteAll} disabled={deleteConfirmation !== 'EXCLUIR TODOS' || deletingAll}>
              {deletingAll ? 'Excluindo...' : 'Excluir permanentemente'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle>Criar novo agendamento</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-blue-100">
                  <ClipboardPenLine className="h-5 w-5" />
                  <p className="font-medium">Formulario oficial completo em uma única entrada</p>
                </div>
                <p className="max-w-2xl text-sm text-zinc-300">
                  Clique em criar e o sistema abre diretamente a tela com todos os campos:
                  empresa, cidade, serviço, técnico, logística, OS e checklist.
                </p>
                <p className="text-xs text-zinc-400">
                  Se quiser parar no meio, o rascunho continua disponível e os agendamentos salvos podem ser reabertos depois para correção.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button className="bg-blue-600 hover:bg-blue-700" onClick={handleCreateAppointment} disabled={creatingDraft}>
                  <Plus className="h-4 w-4 mr-2" />
                  {creatingDraft ? 'Abrindo formulario...' : 'Criar Agendamento'}
                </Button>
                <Link to="/schedule">
                  <Button variant="outline">Ir para Agenda</Button>
                </Link>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-4">
            <p className="text-sm font-medium text-white">Como usar</p>
            <p className="mt-2 text-sm text-zinc-400">
              1. Clique em <span className="text-white">Criar Agendamento</span>.
              2. O sistema abre direto no formulario oficial completo.
              3. Preencha tudo no mesmo lugar.
              4. Depois, se precisar ajustar, use <span className="text-white">Abrir e continuar preenchimento</span> nos cards abaixo.
            </p>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Agendamentos com Pendências</CardTitle>
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
              Clique em mostrar finalizados para consultar atendimentos encerrados e o relato do técnico.
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
                    <p className="text-xs text-muted-foreground">Técnico</p>
                    <p>{item.technician?.name ?? 'Sem técnico vinculado'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Cidade</p>
                    <p>{item.city || 'Não informado'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Endereço</p>
                    <p>{item.fullAddress || 'Não informado'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Tipo de serviço</p>
                    <p>{item.serviceType || 'Não informado'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Maquina</p>
                    <p>{[item.machineName, item.machineModel].filter(Boolean).join(' - ') || 'Não informado'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Número de série</p>
                    <p>{item.machineSerial || 'Não informado'}</p>
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
                    <p>{item.transportMode || (item.needsTransport ? 'Necessario' : 'Não informado')}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Periodo</p>
                    <p>{item.daysOut ?? 1} dia(s)</p>
                  </div>
                </div>

                <div className="rounded-md border bg-muted/30 p-3 text-sm">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Relato do técnico</p>
                  <p className="whitespace-pre-wrap">{technicalReport || 'Relato não informado.'}</p>
                </div>

                {(item.problemDescription || item.notes || item.hotelNotes) && (
                  <div className="rounded-md border bg-muted/30 p-3 text-sm">
                    {item.problemDescription && (
                      <p>
                        <span className="text-muted-foreground">Serviço: </span>
                        {item.problemDescription}
                      </p>
                    )}
                    {item.notes && (
                      <p>
                        <span className="text-muted-foreground">Observações: </span>
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
                  <div className="flex flex-wrap gap-2">
                    <Link to={`/appointments/${item.id}`}>
                      <Button size="sm" variant="outline">Visualizar campos do agendamento</Button>
                    </Link>
                    <Button size="sm" onClick={() => handleReopen(item.id)}>
                      Reabrir agendamento
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
