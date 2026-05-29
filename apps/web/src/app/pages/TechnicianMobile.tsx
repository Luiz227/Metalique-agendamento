import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, Camera, CheckCircle, Clock, FileText, MapPin, Navigation, Phone, Play } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { Textarea } from '../components/ui/textarea';
import { Input } from '../components/ui/input';
import { api, connectRealtime, getToken, getUser } from '../services/api';
import type { Appointment } from '../services/types';
import { formatDate, formatTime, statusLabel, statusTone } from '../services/types';

function isInCurrentWeek(dateValue: string) {
  const date = new Date(dateValue);
  const now = new Date();
  const day = now.getDay();
  const mondayShift = day === 0 ? -6 : 1 - day;
  const start = new Date(now);
  start.setDate(now.getDate() + mondayShift);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return date >= start && date <= end;
}

function wasFinishedByTechnician(appointment: Appointment) {
  return (appointment.statusLogs ?? []).some((log) => log.status === 'COMPLETED_SUCCESS' || log.status === 'COMPLETED_PARTIAL');
}

export default function TechnicianMobile() {
  const user = getUser();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [report, setReport] = useState({ summary: '', diagnosis: '', solution: '', pendingItems: '' });
  const [message, setMessage] = useState('');
  const [activeTripsView, setActiveTripsView] = useState<'WEEK' | 'FINISHED'>('WEEK');
  const [activeSection, setActiveSection] = useState<'LIST' | 'DETAILS' | 'CALENDAR'>('LIST');
  const [monthCursor, setMonthCursor] = useState(() => new Date());
  const knownIdsRef = useRef<Set<string>>(new Set());

  async function load() {
    const rows = await api<Appointment[]>('/technician/appointments');
    const nextIds = new Set(rows.map((item) => item.id));
    const newItems = rows.filter((item) => !knownIdsRef.current.has(item.id));
    if (newItems.length > 0 && Notification.permission === 'granted') {
      new Notification('Novo agendamento confirmado', {
        body: `${newItems[0].client?.name ?? 'Cliente'} - ${newItems[0].city}`
      });
    }
    knownIdsRef.current = nextIds;
    setAppointments(rows);
    setSelectedId((current) => current || rows[0]?.id || '');
  }

  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      load().catch(() => undefined);
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const disconnect = connectRealtime(() => {
      load().catch(() => undefined);
    });
    return () => disconnect();
  }, []);

  const current = useMemo(() => appointments.find((item) => item.id === selectedId) ?? appointments[0], [appointments, selectedId]);
  const upcoming = appointments.filter((item) => item.id !== current?.id && !wasFinishedByTechnician(item));
  const weeklyTrips = useMemo(
    () => appointments.filter((item) => isInCurrentWeek(item.date) && !wasFinishedByTechnician(item)),
    [appointments]
  );
  const finishedTrips = useMemo(() => appointments.filter((item) => wasFinishedByTechnician(item)), [appointments]);
  const visibleTrips = activeTripsView === 'WEEK' ? weeklyTrips : finishedTrips;
  const monthAppointments = useMemo(() => {
    const month = monthCursor.getMonth();
    const year = monthCursor.getFullYear();
    return appointments.filter((item) => {
      const d = new Date(item.date);
      return d.getMonth() === month && d.getFullYear() === year;
    });
  }, [appointments, monthCursor]);

  const monthGrid = useMemo(() => {
    const year = monthCursor.getFullYear();
    const month = monthCursor.getMonth();
    const first = new Date(year, month, 1);
    const startOffset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: Array<{ day: number; count: number; key: string }> = [];
    for (let i = 0; i < startOffset; i++) cells.push({ day: 0, count: 0, key: `empty-${i}` });
    for (let day = 1; day <= daysInMonth; day++) {
      const count = monthAppointments.filter((item) => new Date(item.date).getDate() === day).length;
      cells.push({ day, count, key: `d-${day}` });
    }
    return cells;
  }, [monthAppointments, monthCursor]);

  async function updateStatus(status: string) {
    if (!current) return;
    await api(`/technician/appointments/${current.id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status, observation: report.summary || undefined })
    });
    setMessage('Status atualizado com sucesso.');
    await load();
  }

  async function saveReport() {
    if (!current) return;
    await api(`/technician/appointments/${current.id}/reports`, {
      method: 'POST',
      body: JSON.stringify({ ...report, finishedAt: new Date().toISOString() })
    });
    setReport({ summary: '', diagnosis: '', solution: '', pendingItems: '' });
    setMessage('Relatorio tecnico enviado com sucesso.');
    await load();
  }

  async function uploadFile(file: File | undefined, type: string) {
    if (!current || !file) return;
    const data = new FormData();
    data.append('file', file);
    data.append('type', type);
    const apiBase = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '/api';
    const response = await fetch(`${apiBase}/attachments/appointments/${current.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` },
      body: data
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.message ?? 'Falha ao enviar arquivo');
    }
    setMessage('Arquivo enviado com sucesso.');
    await load();
  }

  if (!current) {
    return (
      <div className="min-h-screen bg-background px-4 py-6">
        <div className="mx-auto w-full max-w-2xl text-muted-foreground">Nenhum atendimento encontrado para este tecnico.</div>
      </div>
    );
  }

  const tone = statusTone(current.status);

  return (
    <div className="min-h-screen bg-background px-3 py-4 sm:px-4 sm:py-6">
      <div className="mx-auto w-full max-w-2xl space-y-4 sm:space-y-5">
        <div className="rounded-2xl bg-gradient-to-r from-[#c8142f] to-[#e3273e] px-4 py-5 sm:px-6">
          <h1 className="text-xl font-bold text-white sm:text-2xl">Ola, {user?.name ?? current.technician?.name ?? 'Tecnico'}</h1>
          <p className="mt-1 text-sm text-red-100 sm:text-base">Voce tem {appointments.length} atendimento(s) vinculado(s)</p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setActiveSection('LIST')}
            className={`rounded-xl border p-3 text-center text-sm ${activeSection === 'LIST' ? 'border-[#c8142f] bg-[#c8142f]/10' : 'border-border bg-card'}`}
          >
            Atendimentos
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('DETAILS')}
            className={`rounded-xl border p-3 text-center text-sm ${activeSection === 'DETAILS' ? 'border-blue-500 bg-blue-500/10' : 'border-border bg-card'}`}
          >
            Detalhes
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('CALENDAR')}
            className={`rounded-xl border p-3 text-center text-sm ${activeSection === 'CALENDAR' ? 'border-green-500 bg-green-500/10' : 'border-border bg-card'}`}
          >
            Calendário
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setActiveTripsView('WEEK')}
            className={`rounded-xl border p-3 text-left ${activeTripsView === 'WEEK' ? 'border-[#c8142f] bg-[#c8142f]/10' : 'border-border bg-card'}`}
          >
            <p className="text-xs text-muted-foreground sm:text-sm">Viagens da semana</p>
            <p className="text-xl font-bold sm:text-2xl">{weeklyTrips.length}</p>
          </button>
          <button
            type="button"
            onClick={() => setActiveTripsView('FINISHED')}
            className={`rounded-xl border p-3 text-left ${activeTripsView === 'FINISHED' ? 'border-green-500 bg-green-500/10' : 'border-border bg-card'}`}
          >
            <p className="text-xs text-muted-foreground sm:text-sm">Viagens finalizadas</p>
            <p className="text-xl font-bold sm:text-2xl">{finishedTrips.length}</p>
          </button>
        </div>

        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="text-base sm:text-lg">
              {activeTripsView === 'WEEK' ? 'Agendamentos da semana' : 'Viagens finalizadas'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {visibleTrips.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {activeTripsView === 'WEEK' ? 'Nenhum agendamento na semana.' : 'Nenhuma viagem finalizada.'}
              </p>
            )}
            {visibleTrips
              .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
              .map((apt) => (
                <button key={apt.id} onClick={() => { setSelectedId(apt.id); setActiveSection('DETAILS'); }} className="w-full rounded-xl border bg-card p-3 text-left">
                  <p className="text-sm font-semibold sm:text-base">{apt.client?.name ?? 'Cliente'}</p>
                  <p className="mt-1 text-xs text-muted-foreground sm:text-sm break-words">{apt.city} - {formatDate(apt.date)} as {formatTime(apt.startTime)}</p>
                </button>
              ))}
          </CardContent>
        </Card>

        {activeSection === 'DETAILS' && (
        <Card className="rounded-2xl">
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base sm:text-lg">Proximo Atendimento</CardTitle>
              <Badge className={tone.color}>{statusLabel(current.status)}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <h3 className="text-lg font-bold sm:text-xl break-words">{current.client.name}</h3>
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground"><Calendar className="h-4 w-4 shrink-0" /><span>{formatDate(current.date)}</span></div>
                <div className="flex items-center gap-2 text-muted-foreground"><Clock className="h-4 w-4 shrink-0" /><span>{formatTime(current.startTime)} ate {formatTime(current.endTime)}</span></div>
                <div className="flex items-start gap-2 text-muted-foreground"><MapPin className="mt-0.5 h-4 w-4 shrink-0" /><span className="break-words">{current.fullAddress}</span></div>
                {current.client.phone && <div className="flex items-center gap-2 text-muted-foreground"><Phone className="h-4 w-4 shrink-0" /><span>{current.client.phone}</span></div>}
              </div>
            </div>

            <Separator />

            {current.serviceType && (
              <div className="rounded-xl border bg-card p-4">
                <p className="text-xs text-muted-foreground">Nome do servico</p>
                <p className="mt-1 text-sm sm:text-base break-words">{current.serviceType}</p>
              </div>
            )}

            {current.problemDescription && (
              <div className="rounded-xl border bg-card p-4">
                <p className="text-xs text-muted-foreground">Descricao do servico</p>
                <p className="mt-1 text-sm sm:text-base break-words">{current.problemDescription}</p>
              </div>
            )}

            {current.notes && (
              <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4">
                <p className="text-xs text-blue-700 dark:text-blue-200">Ponto de atencao</p>
                <p className="mt-1 text-sm text-blue-800 dark:text-blue-100 break-words">{current.notes}</p>
              </div>
            )}

            <div className="space-y-2">
              <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(current.fullAddress)}`} target="_blank" rel="noreferrer">
                <Button className="h-12 w-full text-base bg-[#c8142f] hover:bg-[#a81027]">
                  <Navigation className="mr-2 h-5 w-5" />
                  Abrir rota
                </Button>
              </a>
              <Button className="h-12 w-full text-base bg-green-600 hover:bg-green-700" onClick={() => updateStatus('TRAVELING')}>
                <Play className="mr-2 h-5 w-5" />
                Iniciar deslocamento
              </Button>
            </div>
          </CardContent>
        </Card>
        )}

        {activeSection === 'CALENDAR' && (
        <Card className="rounded-2xl">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base sm:text-lg">Calendario do tecnico</CardTitle>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setMonthCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>{"<"}</Button>
                <span className="text-sm">
                  {monthCursor.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
                </span>
                <Button size="sm" variant="outline" onClick={() => setMonthCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>{">"}</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground mb-2">
              <div>Seg</div><div>Ter</div><div>Qua</div><div>Qui</div><div>Sex</div><div>Sab</div><div>Dom</div>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {monthGrid.map((cell) => (
                <div key={cell.key} className={`rounded-lg border min-h-12 p-1 text-center ${cell.day === 0 ? 'border-transparent' : 'border-border bg-card'}`}>
                  {cell.day > 0 && (
                    <>
                      <div className="text-xs">{cell.day}</div>
                      {cell.count > 0 && <div className="mt-1 text-[10px] rounded bg-blue-600 text-white px-1">{cell.count} ag.</div>}
                    </>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        )}

        {activeSection === 'DETAILS' && (
        <Card className="rounded-2xl">
          <CardHeader><CardTitle className="text-base sm:text-lg">Relatorio Tecnico</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Textarea placeholder="Resumo do atendimento" value={report.summary} onChange={(e) => setReport({ ...report, summary: e.target.value })} />
            <Textarea placeholder="Diagnostico" value={report.diagnosis} onChange={(e) => setReport({ ...report, diagnosis: e.target.value })} />
            <Textarea placeholder="Solucao aplicada" value={report.solution} onChange={(e) => setReport({ ...report, solution: e.target.value })} />
            <Textarea placeholder="Pendencias ou retorno necessario" value={report.pendingItems} onChange={(e) => setReport({ ...report, pendingItems: e.target.value })} />
            <Button className="h-11 w-full bg-[#c8142f] hover:bg-[#a81027]" disabled={!report.summary} onClick={saveReport}>
              Enviar relatorio tecnico
            </Button>
          </CardContent>
        </Card>
        )}

        {activeSection === 'DETAILS' && (
        <Card className="rounded-2xl">
          <CardHeader><CardTitle className="text-base sm:text-lg">Fotos, Videos e Documentos</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <label className="flex h-20 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border text-foreground">
              <Camera className="h-5 w-5" />
              <span className="text-xs">Camera</span>
              <Input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => uploadFile(e.target.files?.[0], 'midia-tecnica')} />
            </label>
            <label className="flex h-20 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border text-foreground">
              <Camera className="h-5 w-5" />
              <span className="text-xs">Galeria</span>
              <Input type="file" accept="image/*,video/*" className="hidden" onChange={(e) => uploadFile(e.target.files?.[0], 'midia-tecnica')} />
            </label>
            <label className="flex h-20 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border text-foreground">
              <FileText className="h-5 w-5" />
              <span className="text-xs">Documento</span>
              <Input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => uploadFile(e.target.files?.[0], 'documento-tecnico')} />
            </label>
          </CardContent>
        </Card>
        )}

        {message && <p className="text-center text-sm text-green-600 dark:text-green-400">{message}</p>}

        {activeSection === 'DETAILS' && (
        <Card className="rounded-2xl">
          <CardHeader><CardTitle className="text-base sm:text-lg">Proximos Atendimentos</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {upcoming.length === 0 && <p className="text-sm text-muted-foreground">Sem proximos atendimentos.</p>}
            {upcoming.map((apt) => (
              <button key={apt.id} onClick={() => setSelectedId(apt.id)} className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
                  <MapPin className="h-5 w-5 text-blue-500" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold sm:text-base">{apt.client.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground break-words">{apt.city} - {formatDate(apt.date)} as {formatTime(apt.startTime)}</p>
                </div>
              </button>
            ))}
          </CardContent>
        </Card>
        )}

        {activeSection === 'DETAILS' && (
        <Button className="h-12 w-full rounded-xl bg-gradient-to-r from-green-600 to-emerald-600 text-base hover:from-green-700 hover:to-emerald-700" onClick={() => updateStatus('COMPLETED_SUCCESS')}>
          <CheckCircle className="mr-2 h-5 w-5" />
          Finalizar atendimento
        </Button>
        )}
      </div>
    </div>
  );
}
