import { type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, Camera, CheckCircle, Clock, FileText, MapPin, Navigation, Phone, Play, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { Textarea } from '../components/ui/textarea';
import { Input } from '../components/ui/input';
import { ApiError, api, clearSession, connectRealtime, getToken, getUser } from '../services/api';
import type { Appointment } from '../services/types';
import { formatDate, formatTime, statusLabel, statusTone } from '../services/types';

type PendingAttachment = {
  id: string;
  file: File;
  displayName: string;
  type: 'midia-tecnica' | 'documento-tecnico';
  previewUrl?: string;
};

function isImageFile(file: File) {
  return file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name);
}

async function compressImageForUpload(file: File) {
  if (!isImageFile(file)) return file;

  const imageUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Nao foi possivel ler a imagem selecionada.'));
      img.src = imageUrl;
    });

    const cleanName = file.name.replace(/\.[^.]+$/, '') || 'foto-tecnica';
    const attempts = [
      { maxSize: 1600, quality: 0.72 },
      { maxSize: 1280, quality: 0.62 },
      { maxSize: 1024, quality: 0.55 }
    ];
    let bestFile: File | null = null;

    for (const attempt of attempts) {
      const ratio = Math.min(1, attempt.maxSize / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * ratio));
      const height = Math.max(1, Math.round(image.height * ratio));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) continue;

      context.drawImage(image, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', attempt.quality));
      if (!blob) continue;

      const nextFile = new File([blob], `${cleanName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
      if (!bestFile || nextFile.size < bestFile.size) bestFile = nextFile;
      if (nextFile.size <= 900 * 1024) return nextFile;
    }

    return bestFile && bestFile.size < file.size ? bestFile : file;
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

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
  const [loadingAppointments, setLoadingAppointments] = useState(true);
  const [appointmentsError, setAppointmentsError] = useState('');
  const [report, setReport] = useState({ summary: '' });
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [savingReport, setSavingReport] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [clientSignatureDataUrl, setClientSignatureDataUrl] = useState('');
  const [technicianSignatureDataUrl, setTechnicianSignatureDataUrl] = useState('');
  const [activeTripsView, setActiveTripsView] = useState<'WEEK' | 'FINISHED'>('WEEK');
  const [activeSection, setActiveSection] = useState<'LIST' | 'DETAILS' | 'CALENDAR'>('LIST');
  const [monthCursor, setMonthCursor] = useState(() => new Date());
  const knownIdsRef = useRef<Set<string>>(new Set());
  const clientSignatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const technicianSignatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingSignatureRef = useRef<'client' | 'technician' | null>(null);

  async function load(silent = false) {
    if (!silent) setLoadingAppointments(true);
    setAppointmentsError('');
    try {
      const rows = await api<Appointment[]>('/technician/appointments');
      const nextIds = new Set(rows.map((item) => item.id));
      const newItems = rows.filter((item) => !knownIdsRef.current.has(item.id));
      if (newItems.length > 0 && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('Novo agendamento confirmado', {
          body: `${newItems[0].client?.name ?? 'Cliente'} - ${newItems[0].city}`
        });
      }
      knownIdsRef.current = nextIds;
      setAppointments(rows);
      setSelectedId((current) => (rows.some((item) => item.id === current) ? current : rows[0]?.id || ''));
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        clearSession();
        setAppointmentsError('Sessao expirada. Saia e entre novamente para carregar seus atendimentos.');
        return;
      }
      setAppointmentsError(err instanceof Error ? err.message : 'Nao foi possivel carregar os atendimentos.');
    } finally {
      setLoadingAppointments(false);
    }
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
      load(true).catch(() => undefined);
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const disconnect = connectRealtime(() => {
      load(true).catch(() => undefined);
    });
    return () => disconnect();
  }, []);

  useEffect(() => {
    return () => {
      pendingAttachments.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
    };
  }, [pendingAttachments]);

  const current = useMemo(() => appointments.find((item) => item.id === selectedId) ?? appointments[0], [appointments, selectedId]);
  const currentServiceOrder = (current?.attachments ?? []).find((attachment) => attachment.kind === 'SERVICE_ORDER_TEMPLATE');
  const currentGeneratedReport = (current?.attachments ?? []).find((attachment) => attachment.kind === 'TECHNICAL_REPORT');
  const upcoming = appointments.filter((item) => item.id !== current?.id && !wasFinishedByTechnician(item));
  const currentClientName = current?.client?.name ?? 'Cliente';
  const currentClientPhone = current?.client?.phone ?? '';
  const currentAddress = current?.fullAddress ?? 'Endereco nao informado';
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
    setErrorMessage('');
    await api(`/technician/appointments/${current.id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status, observation: report.summary || undefined })
    });
    setMessage('Status atualizado com sucesso.');
    await load();
  }

  async function saveReport() {
    if (!current) return;
    setSavingReport(true);
    setMessage('');
    setErrorMessage('');
    try {
      await api(`/technician/appointments/${current.id}/reports`, {
        method: 'POST',
        body: JSON.stringify({
          ...report,
          clientSignatureDataUrl,
          technicianSignatureDataUrl,
          finishedAt: new Date().toISOString()
        })
      });

      for (const attachment of pendingAttachments) {
        try {
          await uploadFileNow(attachment.file, attachment.type, attachment.displayName);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err || 'Falha ao enviar arquivo');
          throw new Error(`Falha ao enviar ${attachment.file.name}: ${reason}`);
        }
      }

      pendingAttachments.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      setPendingAttachments([]);
      clearSignature('client');
      clearSignature('technician');
      setReport({ summary: '' });
      setMessage('Relatório e anexos enviados com sucesso.');
      await load();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err || 'Erro ao enviar relatório/anexos'));
    } finally {
      setSavingReport(false);
    }
  }

  async function uploadFileNow(file: File | undefined, type: string, displayName?: string) {
    if (!current || !file) return;
    const uploadFile = await compressImageForUpload(file);
    const data = new FormData();
    data.append('file', uploadFile, normalizeAttachmentName(displayName || uploadFile.name, uploadFile.name));
    data.append('type', type);
    const apiBase = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '/api';
    const response = await fetch(`${apiBase}/attachments/appointments/${current.id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` },
      body: data
    });
    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      let payload: { message?: string } | null = null;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        payload = null;
      }
      const message = payload?.message ?? (raw.slice(0, 180) || 'Falha ao enviar arquivo');
      throw new Error(`${message} (${response.status})`);
    }
  }

  function addAttachment(file: File | undefined, type: 'midia-tecnica' | 'documento-tecnico') {
    if (!file) return;
    setMessage('');
    setErrorMessage('');
    const isImage = isImageFile(file);
    const previewUrl = isImage ? URL.createObjectURL(file) : undefined;
    const item: PendingAttachment = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      file,
      displayName: file.name,
      type,
      previewUrl
    };
    setPendingAttachments((prev) => [...prev, item]);
  }

  function addAttachments(files: FileList | null, type: 'midia-tecnica' | 'documento-tecnico') {
    if (!files?.length) return;
    Array.from(files).forEach((file) => addAttachment(file, type));
  }

  function renameAttachment(id: string, displayName: string) {
    setPendingAttachments((prev) => prev.map((item) => (item.id === id ? { ...item, displayName } : item)));
  }

  function normalizeAttachmentName(name: string, fallback: string) {
    const cleanName = name.trim() || fallback;
    const hasExtension = /\.[a-z0-9]{2,8}$/i.test(cleanName);
    if (hasExtension) return cleanName;
    const extension = fallback.match(/(\.[a-z0-9]{2,8})$/i)?.[1] ?? '';
    return `${cleanName}${extension}`;
  }

  function getSignatureCanvas(target: 'client' | 'technician') {
    return target === 'client' ? clientSignatureCanvasRef.current : technicianSignatureCanvasRef.current;
  }

  function getSignatureData(target: 'client' | 'technician') {
    return target === 'client' ? clientSignatureDataUrl : technicianSignatureDataUrl;
  }

  function setSignatureData(target: 'client' | 'technician', value: string) {
    if (target === 'client') {
      setClientSignatureDataUrl(value);
      return;
    }
    setTechnicianSignatureDataUrl(value);
  }

  function drawSignature(event: PointerEvent<HTMLCanvasElement>, target: 'client' | 'technician') {
    const canvas = getSignatureCanvas(target);
    if (!canvas || drawingSignatureRef.current !== target) return;
    const rect = canvas.getBoundingClientRect();
    const context = canvas.getContext('2d');
    if (!context) return;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    context.lineWidth = 5;
    context.lineCap = 'round';
    context.strokeStyle = '#111827';
    context.lineTo((event.clientX - rect.left) * scaleX, (event.clientY - rect.top) * scaleY);
    context.stroke();
    setSignatureData(target, canvas.toDataURL('image/png'));
  }

  function startSignature(event: PointerEvent<HTMLCanvasElement>, target: 'client' | 'technician') {
    const canvas = getSignatureCanvas(target);
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if (!getSignatureData(target)) {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    drawingSignatureRef.current = target;
    context.beginPath();
    context.moveTo((event.clientX - rect.left) * scaleX, (event.clientY - rect.top) * scaleY);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function stopSignature(target: 'client' | 'technician') {
    drawingSignatureRef.current = null;
    const canvas = getSignatureCanvas(target);
    if (canvas) setSignatureData(target, canvas.toDataURL('image/png'));
  }

  function clearSignature(target: 'client' | 'technician') {
    const canvas = getSignatureCanvas(target);
    const context = canvas?.getContext('2d');
    if (canvas && context) {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    setSignatureData(target, '');
  }

  function removeAttachment(id: string) {
    setPendingAttachments((prev) => {
      const found = prev.find((x) => x.id === id);
      if (found?.previewUrl) URL.revokeObjectURL(found.previewUrl);
      return prev.filter((x) => x.id !== id);
    });
  }

  if (!current) {
    return (
      <div className="min-h-screen bg-background px-4 py-6">
        <div className="mx-auto w-full max-w-2xl space-y-4">
          <div className="rounded-2xl bg-card p-5">
            <h1 className="text-xl font-bold">Meus Atendimentos</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {user?.name ? `Usuario logado: ${user.name}` : 'Usuario tecnico'}
            </p>
          </div>

          {loadingAppointments ? (
            <div className="rounded-2xl border bg-card p-5 text-muted-foreground">
              Carregando atendimentos do tecnico...
            </div>
          ) : appointmentsError ? (
            <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-5">
              <p className="font-semibold text-red-500">Falha ao carregar atendimentos</p>
              <p className="mt-2 text-sm text-red-300">{appointmentsError}</p>
              <Button className="mt-4 w-full" onClick={() => load()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Tentar novamente
              </Button>
            </div>
          ) : (
            <div className="rounded-2xl border bg-card p-5 text-muted-foreground">
              <p>Nenhum atendimento encontrado para este tecnico.</p>
              <p className="mt-2 text-sm">
                Se existir agendamento confirmado, verifique se o usuario tecnico esta vinculado ao cadastro do tecnico correto.
              </p>
              <Button className="mt-4 w-full" onClick={() => load()}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Atualizar
              </Button>
            </div>
          )}
        </div>
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
            {[...visibleTrips]
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
              <h3 className="text-lg font-bold sm:text-xl break-words">{currentClientName}</h3>
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground"><Calendar className="h-4 w-4 shrink-0" /><span>{formatDate(current.date)}</span></div>
                <div className="flex items-center gap-2 text-muted-foreground"><Clock className="h-4 w-4 shrink-0" /><span>{formatTime(current.startTime)} ate {formatTime(current.endTime)}</span></div>
                <div className="flex items-start gap-2 text-muted-foreground"><MapPin className="mt-0.5 h-4 w-4 shrink-0" /><span className="break-words">{currentAddress}</span></div>
                {currentClientPhone && <div className="flex items-center gap-2 text-muted-foreground"><Phone className="h-4 w-4 shrink-0" /><span>{currentClientPhone}</span></div>}
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
              <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(currentAddress)}`} target="_blank" rel="noreferrer">
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
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3">
              <p className="text-xs font-medium text-blue-700 dark:text-blue-200">OS anexada pelo agendamento</p>
              {currentServiceOrder ? (
                <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border bg-card p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{currentServiceOrder.originalName}</p>
                    <p className="text-[11px] text-muted-foreground">Essa OS serÃ¡ usada como modelo para preencher relato e assinaturas.</p>
                  </div>
                  {currentServiceOrder.publicUrl && (
                    <a href={currentServiceOrder.publicUrl} target="_blank" rel="noreferrer">
                      <Button type="button" variant="outline" size="sm">Abrir OS</Button>
                    </a>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">Nenhuma OS original foi anexada ainda neste atendimento.</p>
              )}
              {currentGeneratedReport?.publicUrl && (
                <div className="mt-2">
                  <a href={currentGeneratedReport.publicUrl} target="_blank" rel="noreferrer">
                    <Button type="button" variant="outline" className="w-full">Ver ultima OS preenchida</Button>
                  </a>
                </div>
              )}
            </div>
            <Textarea
              className="min-h-36 text-base"
              placeholder="Consideracoes do tecnico"
              value={report.summary}
              onChange={(e) => setReport({ summary: e.target.value })}
            />
          </CardContent>
        </Card>
        )}

        {activeSection === 'DETAILS' && (
        <Card className="rounded-2xl">
          <CardHeader><CardTitle className="text-base sm:text-lg">Fotos, Videos e Documentos</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
            <label className="flex h-20 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border text-foreground">
              <Camera className="h-5 w-5" />
              <span className="text-xs">Camera</span>
              <Input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { addAttachment(e.target.files?.[0], 'midia-tecnica'); e.currentTarget.value = ''; }} />
            </label>
            <label className="flex h-20 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border text-foreground">
              <Camera className="h-5 w-5" />
              <span className="text-xs">Galeria</span>
              <Input type="file" multiple accept="image/*,video/*,.jpg,.jpeg,.png,.webp,.heic,.heif,.mp4,.mov,.webm" className="hidden" onChange={(e) => { addAttachments(e.target.files, 'midia-tecnica'); e.currentTarget.value = ''; }} />
            </label>
            <label className="flex h-20 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border text-foreground">
              <FileText className="h-5 w-5" />
              <span className="text-xs">Documento</span>
              <Input type="file" multiple accept=".pdf,image/*,video/*" className="hidden" onChange={(e) => { addAttachments(e.target.files, 'documento-tecnico'); e.currentTarget.value = ''; }} />
            </label>
            </div>
            <div className="rounded-xl border bg-card p-3">
              <p className="text-xs text-muted-foreground mb-2">Arquivos anexados para envio:</p>
              {pendingAttachments.length === 0 && <p className="text-xs text-muted-foreground">Nenhum arquivo selecionado.</p>}
              <div className="space-y-2">
                {pendingAttachments.map((item) => (
                  <div key={item.id} className="rounded-lg border p-2">
                    <div className="flex items-center gap-2">
                      {item.previewUrl ? (
                        <img src={item.previewUrl} alt={item.file.name} className="h-12 w-12 rounded object-cover" />
                      ) : (
                        <div className="h-12 w-12 rounded bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center">
                          <FileText className="h-4 w-4" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">{item.file.name}</p>
                        <p className="text-[11px] text-muted-foreground">{Math.max(1, Math.round(item.file.size / 1024))} KB</p>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={() => removeAttachment(item.id)}>
                        Remover
                      </Button>
                    </div>
                    <Input
                      className="mt-2 h-9 text-xs"
                      placeholder="Nome do arquivo no Drive"
                      value={item.displayName}
                      onChange={(event) => renameAttachment(item.id, event.target.value)}
                    />
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
        )}


        {activeSection === 'DETAILS' && (
        <Card className="rounded-2xl">
          <CardHeader><CardTitle className="text-base sm:text-lg">Assinaturas</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-3">
              <p className="text-sm font-medium">Assinatura do tecnico</p>
              <canvas
                ref={technicianSignatureCanvasRef}
                width={640}
                height={220}
                className="h-44 w-full touch-none rounded-xl border bg-white"
                onPointerDown={(event) => startSignature(event, 'technician')}
                onPointerMove={(event) => drawSignature(event, 'technician')}
                onPointerUp={() => stopSignature('technician')}
                onPointerCancel={() => stopSignature('technician')}
                onPointerLeave={() => stopSignature('technician')}
              />
              <Button type="button" variant="outline" className="w-full" onClick={() => clearSignature('technician')}>
                Limpar assinatura do tecnico
              </Button>
            </div>
            <div className="space-y-3">
              <p className="text-sm font-medium">Assinatura do cliente</p>
              <canvas
                ref={clientSignatureCanvasRef}
                width={640}
                height={220}
                className="h-44 w-full touch-none rounded-xl border bg-white"
                onPointerDown={(event) => startSignature(event, 'client')}
                onPointerMove={(event) => drawSignature(event, 'client')}
                onPointerUp={() => stopSignature('client')}
                onPointerCancel={() => stopSignature('client')}
                onPointerLeave={() => stopSignature('client')}
              />
              <Button type="button" variant="outline" className="w-full" onClick={() => clearSignature('client')}>
                Limpar assinatura do cliente
              </Button>
            </div>
          </CardContent>
        </Card>
        )}

        {activeSection === 'DETAILS' && (
        <Button className="h-12 w-full rounded-xl bg-[#c8142f] hover:bg-[#a81027]" disabled={!report.summary || !clientSignatureDataUrl || !technicianSignatureDataUrl || savingReport} onClick={saveReport}>
          {savingReport ? 'Enviando...' : `Enviar relatório técnico${pendingAttachments.length ? ` + ${pendingAttachments.length} anexo(s)` : ''}`}
        </Button>
        )}

        {message && <p className="text-center text-sm text-green-600 dark:text-green-400">{message}</p>}
        {errorMessage && <p className="text-center text-sm text-red-600 dark:text-red-400">{errorMessage}</p>}

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
                  <p className="truncate text-sm font-semibold sm:text-base">{apt.client?.name ?? 'Cliente'}</p>
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
