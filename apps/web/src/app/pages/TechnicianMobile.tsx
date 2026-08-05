import { type PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, Camera, Car, Clock, FileText, MapPin, Navigation, Phone, Plane, Play, RefreshCw, Video } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { Textarea } from '../components/ui/textarea';
import { Input } from '../components/ui/input';
import { ApiError, api, clearSession, connectRealtime, getToken, getUser, resolveApiAssetUrl } from '../services/api';
import {
  countOfflineUploads,
  createOfflineUploadId,
  deleteOfflineUpload,
  enqueueOfflineUpload,
  listOfflineUploads,
  type OfflineQueuedAttachment,
  type OfflineReportPayload,
  type OfflineUploadItem,
  type OfflineUploadMode
} from '../services/offlineUploadQueue';
import type { Appointment } from '../services/types';
import { formatDate, formatTime, statusLabel, statusTone } from '../services/types';

type PendingAttachment = {
  id: string;
  file: File;
  displayName: string;
  type: 'midia-tecnica' | 'documento-tecnico' | 'video-retirada-veiculo' | 'video-devolucao-veiculo' | 'foto-retirada-veiculo' | 'foto-devolucao-veiculo';
  category: 'general-media' | 'general-document' | 'car-pickup-photo' | 'car-return-photo';
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
      img.onerror = () => reject(new Error('Não foi possível ler a imagem selecionada.'));
      img.src = imageUrl;
    });

    const cleanName = file.name.replace(/\.[^.]+$/, '') || 'foto-técnica';
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

async function showBrowserNotification(title: string, options?: NotificationOptions) {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;

  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration?.showNotification) {
      await registration.showNotification(title, options);
    }
  } catch {
    // Ignora falhas de notificação para não quebrar a tela do técnico.
  }
}

function readStoredIds(key: string) {
  if (!key) return new Set<string>();
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return new Set<string>(Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []);
  } catch {
    return new Set<string>();
  }
}

function writeStoredIds(key: string, ids: Iterable<string>) {
  if (!key) return;
  localStorage.setItem(key, JSON.stringify(Array.from(ids).slice(-300)));
}

function buildDefaultAttachmentName(
  fileName: string,
  category: PendingAttachment['category'],
  sequence?: number
) {
  if (category === 'car-pickup-photo') return `retirada-veiculo-foto-${sequence ?? 1}-${fileName}`;
  if (category === 'car-return-photo') return `devolucao-veiculo-foto-${sequence ?? 1}-${fileName}`;
  return fileName;
}

const VEHICLE_PHOTOS_REQUIRED = 4;
const MAX_VIDEO_ATTACHMENT_SIZE = 100 * 1024 * 1024;
const MAX_VIDEO_ATTACHMENT_SIZE_MB = Math.round(MAX_VIDEO_ATTACHMENT_SIZE / 1024 / 1024);
const UPLOAD_RETRY_DELAYS_MS = [0, 1500, 3500, 7000];
const VEHICLE_PHOTO_LABELS = [
  'banco-traseiro-chao',
  'banco-dianteiro-painel',
  'lateral-externa',
  'odometro-quilometragem'
];

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryUploadStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

async function fetchUploadWithRetry(url: string, buildData: () => FormData) {
  let lastError: unknown = null;
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt < UPLOAD_RETRY_DELAYS_MS.length; attempt += 1) {
    const delay = UPLOAD_RETRY_DELAYS_MS[attempt];
    if (delay > 0) await wait(delay);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: buildData()
      });

      if (response.ok) return response;
      lastResponse = response;
      if (!shouldRetryUploadStatus(response.status)) return response;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastResponse) return lastResponse;
  const message = lastError instanceof Error && lastError.message ? lastError.message : 'Falha de rede';
  throw new Error(`${message}. Verifique a internet e tente enviar novamente.`);
}

function isPickupVehicleEvidence(attachment: { kind: string; originalName: string }) {
  return attachment.kind === 'VEHICLE_PICKUP_VIDEO' || attachment.originalName.toLowerCase().startsWith('retirada-veiculo-');
}

function isReturnVehicleEvidence(attachment: { kind: string; originalName: string }) {
  return attachment.kind === 'VEHICLE_RETURN_VIDEO' || attachment.originalName.toLowerCase().startsWith('devolucao-veiculo-');
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

function isNetworkLikeError(error: unknown) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /failed to fetch|network|internet|falha de rede|verifique a internet|load failed/i.test(message);
}

function serializeAttachmentForQueue(attachment: PendingAttachment): OfflineQueuedAttachment {
  return {
    id: attachment.id,
    fileName: attachment.file.name,
    fileType: attachment.file.type || 'application/octet-stream',
    fileSize: attachment.file.size,
    lastModified: attachment.file.lastModified || Date.now(),
    displayName: attachment.displayName,
    attachmentType: attachment.type,
    category: attachment.category,
    blob: attachment.file
  };
}

function fileFromQueuedAttachment(attachment: OfflineQueuedAttachment) {
  return new File([attachment.blob], attachment.fileName, {
    type: attachment.fileType || 'application/octet-stream',
    lastModified: attachment.lastModified || Date.now()
  });
}

export default function TechnicianMobile() {
  const user = getUser();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loadingAppointments, setLoadingAppointments] = useState(true);
  const [appointmentsError, setAppointmentsError] = useState('');
  const [report, setReport] = useState({ summary: '' });
  const [internalNote, setInternalNote] = useState('');
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [savingReport, setSavingReport] = useState(false);
  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [offlineSyncing, setOfflineSyncing] = useState(false);
  const [offlineMessage, setOfflineMessage] = useState('');
  const [savedTechnicianSignature, setSavedTechnicianSignature] = useState('');
  const [uploadingVehicleStage, setUploadingVehicleStage] = useState<'pickup' | 'return' | null>(null);
  const [pickupMileage, setPickupMileage] = useState('');
  const [returnMileage, setReturnMileage] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [locallySubmittedReportIds, setLocallySubmittedReportIds] = useState<Set<string>>(() => new Set());
  const [clientSignatureDataUrl, setClientSignatureDataUrl] = useState('');
  const [technicianSignatureDataUrl, setTechnicianSignatureDataUrl] = useState('');
  const [routeOptionsOpen, setRouteOptionsOpen] = useState(false);
  const [activeTripsView, setActiveTripsView] = useState<'ACTIVE' | 'FINISHED'>('ACTIVE');
  const [activeSection, setActiveSection] = useState<'LIST' | 'DETAILS' | 'CALENDAR'>('LIST');
  const [monthCursor, setMonthCursor] = useState(() => new Date());
  const knownIdsRef = useRef<Set<string>>(new Set());
  const notificationBaselineLoadedRef = useRef(false);
  const clientSignatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const technicianSignatureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingSignatureRef = useRef<'client' | 'technician' | null>(null);

  async function load(silent = false) {
    if (!silent) setLoadingAppointments(true);
    setAppointmentsError('');
    try {
      const rows = await api<Appointment[]>('/technician/appointments');
      const nextIds = new Set(rows.map((item) => item.id));
      const notificationKey = user?.id ? `sp-technician-confirmed-alerted-${user.id}` : '';
      const alertedIds = readStoredIds(notificationKey);
      const hasStoredBaseline = Boolean(notificationKey && localStorage.getItem(notificationKey));
      const newItems = rows.filter((item) => !knownIdsRef.current.has(item.id) && !alertedIds.has(item.id));

      if (!notificationBaselineLoadedRef.current && !hasStoredBaseline) {
        nextIds.forEach((id) => alertedIds.add(id));
        writeStoredIds(notificationKey, alertedIds);
      } else if (newItems.length > 0 && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const appointment = newItems[0];
        await showBrowserNotification('Novo agendamento confirmado', {
          body: `${appointment.client?.name ?? 'Cliente'} - ${appointment.city}`
        });
        newItems.forEach((item) => alertedIds.add(item.id));
        writeStoredIds(notificationKey, alertedIds);
      }
      notificationBaselineLoadedRef.current = true;
      knownIdsRef.current = nextIds;
      setAppointments(rows);
      setSelectedId((current) => (rows.some((item) => item.id === current) ? current : rows[0]?.id || ''));
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        clearSession();
        setAppointmentsError('Sessão expirada. Saia e entre novamente para carregar seus atendimentos.');
        return;
      }
      setAppointmentsError(err instanceof Error ? err.message : 'Não foi possível carregar os atendimentos.');
    } finally {
      setLoadingAppointments(false);
    }
  }

  useEffect(() => {
    load().catch(() => undefined);
    refreshOfflineQueueCount().catch(() => undefined);
    api<{ signatureDataUrl: string | null }>('/technician/profile')
      .then((profile) => {
        const signature = profile.signatureDataUrl || '';
        setSavedTechnicianSignature(signature);
        setTechnicianSignatureDataUrl(signature);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      syncOfflineUploads().catch(() => undefined);
    };
    window.addEventListener('online', handleOnline);
    if (navigator.onLine) syncOfflineUploads().catch(() => undefined);
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  useEffect(() => {
    if (activeSection !== 'DETAILS' || !savedTechnicianSignature) return;
    const canvas = technicianSignatureCanvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const image = new Image();
    image.onload = () => {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    };
    image.src = savedTechnicianSignature;
  }, [activeSection, selectedId, savedTechnicianSignature]);

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
  const currentGeneratedReport = (current?.attachments ?? []).find(
    (attachment) =>
      attachment.kind === 'TECHNICAL_REPORT' ||
      attachment.originalName.toLowerCase().startsWith('ordem-servico-preenchida-')
  );
  const technicalReportSubmitted = Boolean(current?.id && locallySubmittedReportIds.has(current.id)) || Boolean(currentGeneratedReport) || Boolean(
    current?.statusLogs?.some((log) => log.status === 'TECHNICAL_REPORT_SUBMITTED')
  );
  const upcoming = appointments.filter((item) => item.id !== current?.id && !wasFinishedByTechnician(item));
  const currentClientName = current?.client?.name ?? 'Cliente';
  const currentClientPhone = current?.client?.phone ?? '';
  const currentAddress = current?.fullAddress ?? 'Endereço não informado';
  const routeDestination = encodeURIComponent(currentAddress);
  const googleMapsRouteUrl = `https://www.google.com/maps/dir/?api=1&destination=${routeDestination}`;
  const wazeRouteUrl = `https://waze.com/ul?q=${routeDestination}&navigate=yes`;
  const appleMapsRouteUrl = `https://maps.apple.com/?daddr=${routeDestination}`;
  const isCarTrip = current?.transportMode === 'CAR';
  const pickupVehiclePhotos = (current?.attachments ?? []).filter(isPickupVehicleEvidence);
  const returnVehiclePhotos = (current?.attachments ?? []).filter(isReturnVehicleEvidence);
  const pickupVehiclePhotosComplete = !isCarTrip || pickupVehiclePhotos.length >= VEHICLE_PHOTOS_REQUIRED;
  const returnVehiclePhotosComplete = !isCarTrip || returnVehiclePhotos.length >= VEHICLE_PHOTOS_REQUIRED;
  const missingVehiclePickupPhotos = isCarTrip && !pickupVehiclePhotosComplete;
  const canSendReport =
    Boolean(report.summary) &&
    Boolean(clientSignatureDataUrl) &&
    Boolean(technicianSignatureDataUrl) &&
    !savingReport &&
    !missingVehiclePickupPhotos &&
    !technicalReportSubmitted;
  const canWriteInternalNote = Boolean(clientSignatureDataUrl);
  const activeTrips = useMemo(
    () => appointments.filter((item) => !wasFinishedByTechnician(item)),
    [appointments]
  );
  const finishedTrips = useMemo(() => appointments.filter((item) => wasFinishedByTechnician(item)), [appointments]);
  const visibleTrips = activeTripsView === 'ACTIVE' ? activeTrips : finishedTrips;

  useEffect(() => {
    setPickupMileage(current?.vehiclePickupMileage != null ? String(current.vehiclePickupMileage) : '');
    setReturnMileage(current?.vehicleReturnMileage != null ? String(current.vehicleReturnMileage) : '');
  }, [current?.id, current?.vehiclePickupMileage, current?.vehicleReturnMileage]);
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

  async function refreshOfflineQueueCount() {
    try {
      setOfflineQueueCount(await countOfflineUploads());
    } catch {
      setOfflineQueueCount(0);
    }
  }

  function buildReportPayload(): OfflineReportPayload {
    return {
      ...report,
      internalNote: internalNote.trim() || undefined,
      clientSignatureDataUrl,
      technicianSignatureDataUrl,
      finishedAt: new Date().toISOString()
    };
  }

  function buildOfflineItem(
    mode: OfflineUploadMode,
    appointment: Appointment,
    payload: OfflineReportPayload | undefined,
    attachments: PendingAttachment[]
  ): OfflineUploadItem {
    return {
      id: createOfflineUploadId(mode, appointment.id),
      mode,
      appointmentId: appointment.id,
      appointmentLabel: appointment.client?.name ?? appointment.city ?? 'Atendimento',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attempts: 0,
      reportPayload: payload,
      attachments: attachments.map(serializeAttachmentForQueue)
    };
  }

  async function saveCurrentUploadOffline(mode: OfflineUploadMode, payload?: OfflineReportPayload, attachments = pendingAttachments) {
    if (!current) return;
    await enqueueOfflineUpload(buildOfflineItem(mode, current, payload, attachments));
    attachments.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    setPendingAttachments((prev) => prev.filter((item) => !attachments.some((queued) => queued.id === item.id)));
    await refreshOfflineQueueCount();
  }

  async function submitReportPayload(appointmentId: string, payload: OfflineReportPayload) {
    await api(`/technician/appointments/${appointmentId}/reports`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  async function uploadQueuedAttachments(appointmentId: string, attachments: OfflineQueuedAttachment[]) {
    for (const attachment of attachments) {
      await uploadFileNow(
        fileFromQueuedAttachment(attachment),
        attachment.attachmentType,
        attachment.displayName,
        appointmentId
      );
      if (attachments.length > 1) await wait(500);
    }
  }

  async function syncOfflineUploads(showSuccessMessage = false) {
    if (offlineSyncing) return;
    setOfflineSyncing(true);
    setOfflineMessage('');
    try {
      const queuedItems = await listOfflineUploads();
      let sentCount = 0;

      for (const item of queuedItems) {
        try {
          if (item.mode === 'report' && item.reportPayload) {
            await submitReportPayload(item.appointmentId, item.reportPayload);
          }
          await uploadQueuedAttachments(item.appointmentId, item.attachments ?? []);
          await deleteOfflineUpload(item.id);
          sentCount += 1;
        } catch (err) {
          if (!isNetworkLikeError(err)) {
            await enqueueOfflineUpload({
              ...item,
              attempts: item.attempts + 1,
              updatedAt: new Date().toISOString()
            });
          }
          break;
        }
      }

      await refreshOfflineQueueCount();
      if (sentCount > 0) {
        setOfflineMessage(`${sentCount} envio(s) offline sincronizado(s) com sucesso.`);
        await load(true);
      } else if (showSuccessMessage) {
        setOfflineMessage('Nenhum envio pendente para sincronizar.');
      }
    } catch (err) {
      setOfflineMessage(err instanceof Error ? err.message : 'Nao foi possivel sincronizar a fila offline.');
    } finally {
      setOfflineSyncing(false);
    }
  }

  async function saveReport() {
    if (!current) return;
    if (isCarTrip && !pickupVehiclePhotosComplete) {
      setErrorMessage('Para viagens de carro, envie primeiro as 4 fotos e a quilometragem de retirada.');
      return;
    }
    setSavingReport(true);
    setMessage('');
    setErrorMessage('');
    let reportSubmittedNow = false;
    try {
      const submittedTechnicianSignature = technicianSignatureDataUrl;
      const payload = buildReportPayload();
      if (submittedTechnicianSignature && submittedTechnicianSignature !== savedTechnicianSignature) {
        const saved = await api<{ signatureDataUrl: string }>('/technician/profile/signature', {
          method: 'PUT',
          body: JSON.stringify({ signatureDataUrl: submittedTechnicianSignature })
        });
        setSavedTechnicianSignature(saved.signatureDataUrl || submittedTechnicianSignature);
      }
      await submitReportPayload(current.id, payload);
      reportSubmittedNow = true;
      setLocallySubmittedReportIds((prev) => new Set(prev).add(current.id));

      try {
        await uploadPendingAttachmentsBatch();
      } catch (err) {
        if (isNetworkLikeError(err) && pendingAttachments.length > 0) {
          await saveCurrentUploadOffline('attachments', undefined, pendingAttachments);
          setMessage('Relatorio enviado ao Drive. Anexos salvos no aparelho e serao enviados quando a internet voltar.');
          await load(true);
          return;
        }
        throw err;
      }
      clearSignature('client');
      setTechnicianSignatureDataUrl(submittedTechnicianSignature);
      setReport({ summary: '' });
      setInternalNote('');
      setMessage(isCarTrip
        ? 'Relatório e anexos enviados ao Drive. Finalize depois com a KM e as 4 fotos de devolução.'
        : 'Relatório enviado com sucesso e atendimento finalizado.');
      await load();
    } catch (err) {
      if (!reportSubmittedNow && isNetworkLikeError(err)) {
        try {
          await saveCurrentUploadOffline('report', buildReportPayload(), pendingAttachments);
          setMessage('Sem internet agora. Relatorio, assinaturas e anexos foram salvos no aparelho e serao enviados automaticamente.');
          setErrorMessage('');
          return;
        } catch (queueErr) {
          setMessage('');
          setErrorMessage(queueErr instanceof Error ? queueErr.message : 'Nao foi possivel salvar o envio offline.');
          return;
        }
      }
      setMessage('');
      setErrorMessage(err instanceof Error ? err.message : String(err || 'Erro ao enviar relatório/anexos'));
    } finally {
      setSavingReport(false);
    }
  }

  async function uploadPendingAttachmentsOnly() {
    if (!current || pendingAttachments.length === 0) return;
    setSavingReport(true);
    setMessage('');
    setErrorMessage('');
    try {
      await uploadPendingAttachmentsBatch();
      setMessage('Arquivos enviados ao Drive com sucesso.');
      await load(true);
    } catch (err) {
      if (isNetworkLikeError(err) && pendingAttachments.length > 0) {
        try {
          await saveCurrentUploadOffline('attachments', undefined, pendingAttachments);
          setMessage('Anexos salvos no aparelho. Eles serao enviados automaticamente quando a internet voltar.');
          setErrorMessage('');
          return;
        } catch (queueErr) {
          setErrorMessage(queueErr instanceof Error ? queueErr.message : 'Nao foi possivel salvar os anexos offline.');
          return;
        }
      }
      setErrorMessage(err instanceof Error ? err.message : String(err || 'Erro ao enviar anexos'));
    } finally {
      setSavingReport(false);
    }
  }

  async function uploadPendingAttachmentsBatch() {
    if (pendingAttachments.length === 0) {
      setPendingAttachments([]);
      return;
    }

    const failedAttachments: PendingAttachment[] = [];
    const failedMessages: string[] = [];

    for (const attachment of pendingAttachments) {
      try {
        await uploadFileNow(attachment.file, attachment.type, attachment.displayName);
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
        if (pendingAttachments.length > 1) await wait(500);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err || 'Falha ao enviar arquivo');
        failedAttachments.push(attachment);
        failedMessages.push(`${attachment.file.name}: ${reason}`);
      }
    }

    setPendingAttachments(failedAttachments);

    if (failedMessages.length > 0) {
      const sentCount = pendingAttachments.length - failedAttachments.length;
      const sentPrefix = sentCount > 0 ? `${sentCount} arquivo(s) enviado(s). ` : '';
      throw new Error(`${sentPrefix}Falha em ${failedAttachments.length} arquivo(s): ${failedMessages.join(' | ')}`);
    }
  }

  async function uploadFileNow(file: File | undefined, type: string, displayName?: string, appointmentId = current?.id) {
    if (!appointmentId || !file) return;
    if (file.type.startsWith('video/') && file.size > MAX_VIDEO_ATTACHMENT_SIZE) {
      throw new Error(`Video muito grande. Grave um video menor ou envie o arquivo com ate ${MAX_VIDEO_ATTACHMENT_SIZE_MB} MB.`);
    }
    const uploadFile = await compressImageForUpload(file);
    const buildData = () => {
      const data = new FormData();
      data.append('file', uploadFile, normalizeAttachmentName(displayName || uploadFile.name, uploadFile.name));
      data.append('type', type);
      return data;
    };
    const apiBase = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '/api';
    const response = await fetchUploadWithRetry(`${apiBase}/attachments/appointments/${appointmentId}`, buildData);
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

  async function saveVehicleMileage(stage: 'pickup' | 'return') {
    if (!current) throw new Error('Agendamento não selecionado.');
    const mileageText = stage === 'pickup' ? pickupMileage : returnMileage;
    const mileage = Number(mileageText);
    if (!Number.isInteger(mileage) || mileage < 0) {
      throw new Error(`Informe a quilometragem de ${stage === 'pickup' ? 'retirada' : 'devolução'}.`);
    }
    await api(`/technician/appointments/${current.id}/vehicle-mileage`, {
      method: 'POST',
      body: JSON.stringify({ stage, mileage })
    });
  }

  async function saveTechnicianSignatureToProfile() {
    if (!technicianSignatureDataUrl) {
      setErrorMessage('Desenhe a assinatura do tecnico antes de salvar.');
      return;
    }
    setErrorMessage('');
    try {
      const saved = await api<{ signatureDataUrl: string }>('/technician/profile/signature', {
        method: 'PUT',
        body: JSON.stringify({ signatureDataUrl: technicianSignatureDataUrl })
      });
      setSavedTechnicianSignature(saved.signatureDataUrl || technicianSignatureDataUrl);
      setMessage('Assinatura do tecnico salva para os proximos atendimentos.');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Nao foi possivel salvar a assinatura do tecnico.');
    }
  }

  async function uploadVehiclePhotos(files: FileList | null | undefined, stage: 'pickup' | 'return') {
    const selectedFiles = Array.from(files ?? []).filter((file) => isImageFile(file));
    if (selectedFiles.length === 0) {
      setErrorMessage(`Selecione uma foto de ${stage === 'pickup' ? 'retirada' : 'devolução'} do veículo.`);
      return;
    }
    const existingCount = stage === 'pickup' ? pickupVehiclePhotos.length : returnVehiclePhotos.length;
    const remainingCount = Math.max(VEHICLE_PHOTOS_REQUIRED - existingCount, 0);
    if (remainingCount === 0) {
      setMessage(`As ${VEHICLE_PHOTOS_REQUIRED} fotos de ${stage === 'pickup' ? 'retirada' : 'devolução'} já foram enviadas.`);
      return;
    }
    const mileageText = stage === 'pickup' ? pickupMileage : returnMileage;
    const mileage = Number(mileageText);
    if (!Number.isInteger(mileage) || mileage < 0) {
      setErrorMessage(`Informe a quilometragem de ${stage === 'pickup' ? 'retirada' : 'devolução'} antes de enviar as fotos.`);
      return;
    }
    const type = stage === 'pickup' ? 'foto-retirada-veiculo' : 'foto-devolucao-veiculo';
    const category = stage === 'pickup' ? 'car-pickup-photo' : 'car-return-photo';
    setUploadingVehicleStage(stage);
    setMessage('');
    setErrorMessage('');
    try {
      await saveVehicleMileage(stage);
      const filesToUpload = selectedFiles.slice(0, remainingCount);
      for (let index = 0; index < filesToUpload.length; index += 1) {
        const file = filesToUpload[index];
        const sequence = existingCount + index + 1;
        const label = VEHICLE_PHOTO_LABELS[sequence - 1] ?? `foto-${sequence}`;
        await uploadFileNow(file, type, buildDefaultAttachmentName(`${label}-${file.name}`, category, sequence));
      }
      const totalUploaded = existingCount + filesToUpload.length;
      if (totalUploaded >= VEHICLE_PHOTOS_REQUIRED) {
        setMessage(stage === 'pickup'
          ? 'Fotos de retirada enviadas. O relatório técnico foi liberado.'
          : 'Fotos de devolução enviadas. Atendimento finalizado com sucesso.');
      } else {
        setMessage(`Foto enviada. Faltam ${VEHICLE_PHOTOS_REQUIRED - totalUploaded} foto(s) de ${stage === 'pickup' ? 'retirada' : 'devolução'} do veículo.`);
      }
      await load(true);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Não foi possível enviar as fotos do veículo.');
    } finally {
      setUploadingVehicleStage(null);
    }
  }

  function addAttachment(
    file: File | undefined,
    type: PendingAttachment['type'],
    category: PendingAttachment['category'] = type === 'documento-tecnico' ? 'general-document' : 'general-media'
  ) {
    if (!file) return;
    setMessage('');
    setErrorMessage('');
    if (file.type.startsWith('video/') && file.size > MAX_VIDEO_ATTACHMENT_SIZE) {
      setErrorMessage(`Video muito grande. Grave um video menor ou envie o arquivo com ate ${MAX_VIDEO_ATTACHMENT_SIZE_MB} MB.`);
      return;
    }
    const isImage = isImageFile(file);
    const previewUrl = isImage ? URL.createObjectURL(file) : undefined;
    const item: PendingAttachment = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      file,
      displayName: buildDefaultAttachmentName(file.name, category),
      type,
      category,
      previewUrl
    };
    setPendingAttachments((prev) => [...prev, item]);
  }

  function addAttachments(
    files: FileList | null,
    type: 'midia-tecnica' | 'documento-tecnico',
    category: PendingAttachment['category'] = type === 'documento-tecnico' ? 'general-document' : 'general-media'
  ) {
    if (!files?.length) return;
    Array.from(files).forEach((file) => addAttachment(file, type, category));
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
              {user?.name ? `Usuário logado: ${user.name}` : 'Usuário técnico'}
            </p>
          </div>

          {loadingAppointments ? (
            <div className="rounded-2xl border bg-card p-5 text-muted-foreground">
              Carregando atendimentos do técnico...
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
              <p>Nenhum atendimento encontrado para este técnico.</p>
              <p className="mt-2 text-sm">
                Se existir agendamento confirmado, verifique se o usuário técnico está vinculado ao cadastro do técnico correto.
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
          <h1 className="text-xl font-bold text-white sm:text-2xl">Olá, {user?.name ?? current.technician?.name ?? 'Técnico'}</h1>
          <p className="mt-1 text-sm text-red-100 sm:text-base">Você tem {activeTrips.length} atendimento(s) ativo(s)</p>
        </div>

        {(offlineQueueCount > 0 || offlineMessage) && (
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-amber-300">Fila offline</p>
                <p className="mt-1 text-muted-foreground">
                  {offlineQueueCount > 0
                    ? `${offlineQueueCount} envio(s) salvo(s) no aparelho aguardando internet.`
                    : offlineMessage}
                </p>
                {offlineQueueCount > 0 && offlineMessage && <p className="mt-1 text-muted-foreground">{offlineMessage}</p>}
              </div>
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                disabled={offlineSyncing}
                onClick={() => syncOfflineUploads(true)}
              >
                {offlineSyncing ? 'Sincronizando...' : 'Sincronizar agora'}
              </Button>
            </div>
          </div>
        )}
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
            onClick={() => setActiveTripsView('ACTIVE')}
            className={`rounded-xl border p-3 text-left ${activeTripsView === 'ACTIVE' ? 'border-[#c8142f] bg-[#c8142f]/10' : 'border-border bg-card'}`}
          >
            <p className="text-xs text-muted-foreground sm:text-sm">Atendimentos ativos</p>
            <p className="text-xl font-bold sm:text-2xl">{activeTrips.length}</p>
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
              {activeTripsView === 'ACTIVE' ? 'Atendimentos ativos' : 'Viagens finalizadas'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {visibleTrips.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {activeTripsView === 'ACTIVE' ? 'Nenhum atendimento ativo encontrado.' : 'Nenhuma viagem finalizada.'}
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
              <CardTitle className="text-base sm:text-lg">Próximo Atendimento</CardTitle>
              <Badge className={tone.color}>{statusLabel(current.status)}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <h3 className="text-lg font-bold sm:text-xl break-words">{currentClientName}</h3>
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground"><Calendar className="h-4 w-4 shrink-0" /><span>{formatDate(current.date)}</span></div>
                <div className="flex items-center gap-2 text-muted-foreground"><Clock className="h-4 w-4 shrink-0" /><span>{formatTime(current.startTime)} até {formatTime(current.endTime)}</span></div>
                <div className="flex items-start gap-2 text-muted-foreground"><MapPin className="mt-0.5 h-4 w-4 shrink-0" /><span className="break-words">{currentAddress}</span></div>
                {currentClientPhone && <div className="flex items-center gap-2 text-muted-foreground"><Phone className="h-4 w-4 shrink-0" /><span>{currentClientPhone}</span></div>}
              </div>
            </div>

            <Separator />

            {current.serviceType && (
              <div className="rounded-xl border bg-card p-4">
                <p className="text-xs text-muted-foreground">Tipo de serviço</p>
                <p className="mt-1 text-sm sm:text-base break-words">{current.serviceType}</p>
              </div>
            )}

            {current.problemDescription && (
              <div className="rounded-xl border bg-card p-4">
                <p className="text-xs text-muted-foreground">Descrição do serviço</p>
                <p className="mt-1 text-sm sm:text-base break-words">{current.problemDescription}</p>
              </div>
            )}

            {current.notes && (
              <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4">
                <p className="text-xs text-blue-700 dark:text-blue-200">Ponto de atenção</p>
                <p className="mt-1 text-sm text-blue-800 dark:text-blue-100 break-words">{current.notes}</p>
              </div>
            )}

            {isCarTrip && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
                <div className="flex items-start gap-3">
                  <Car className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-amber-100">Veículo da viagem</p>
                    {current.vehicle ? (
                      <div className="mt-2 space-y-1 text-sm text-amber-50/90">
                        <p className="font-medium">{current.vehicle.name} - {current.vehicle.plate}</p>
                        <p>Ano: {current.vehicle.year ?? 'Não informado'} | KM: {new Intl.NumberFormat('pt-BR').format(current.vehicle.mileage ?? 0)}</p>
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-amber-50/90">Veículo ainda não informado pela logística.</p>
                    )}
                    <p className="mt-2 text-xs text-amber-100/80">
                      Envie as 4 fotos da retirada antes de sair e as 4 fotos da devolução ao retornar com o veículo.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {current.transportMode === 'AIR' && (
              <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-4">
                <div className="flex items-start gap-3">
                  <Plane className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" />
                  <div className="min-w-0 space-y-1 text-sm text-sky-50/90">
                    <p className="font-semibold text-sky-100">Informaées da viagem aérea</p>
                    <p><strong>Aeroporto do voo de ida:</strong> {current.flightOutboundAirport || current.flightAirport || 'Não informado'}</p>
                    <p><strong>Aeroporto do voo de volta:</strong> {current.flightReturnAirport || current.flightAirport || 'Não informado'}</p>
                    <p><strong>Voo de ida:</strong> {current.flightDepartureAt ? new Date(current.flightDepartureAt).toLocaleString('pt-BR') : 'Não informado'}</p>
                    <p><strong>Voo de volta:</strong> {current.flightReturnAt ? new Date(current.flightReturnAt).toLocaleString('pt-BR') : 'Não informado'}</p>
                    <p className="pt-1 text-xs text-sky-100/80">Viagens aéreas não exigem fotos de retirada ou devolução de veículo.</p>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="space-y-2">
                <Button
                  type="button"
                  className="h-12 w-full text-base bg-[#c8142f] hover:bg-[#a81027]"
                  onClick={() => setRouteOptionsOpen((value) => !value)}
                >
                  <Navigation className="mr-2 h-5 w-5" />
                  Abrir rota
                </Button>
                {routeOptionsOpen && (
                  <div className="grid grid-cols-1 gap-2 rounded-2xl border bg-card p-3 shadow-lg sm:grid-cols-3">
                    <a href={googleMapsRouteUrl} target="_blank" rel="noreferrer">
                      <Button type="button" variant="outline" className="w-full justify-start">
                        Google Maps
                      </Button>
                    </a>
                    <a href={wazeRouteUrl} target="_blank" rel="noreferrer">
                      <Button type="button" variant="outline" className="w-full justify-start">
                        Waze
                      </Button>
                    </a>
                    <a href={appleMapsRouteUrl} target="_blank" rel="noreferrer">
                      <Button type="button" variant="outline" className="w-full justify-start">
                        Apple Maps
                      </Button>
                    </a>
                  </div>
                )}
              </div>
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
              <CardTitle className="text-base sm:text-lg">Calendário do técnico</CardTitle>
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

        {activeSection === 'DETAILS' && (!isCarTrip || pickupVehiclePhotosComplete) && (
        <Card className="rounded-2xl">
          <CardHeader><CardTitle className="text-base sm:text-lg">Relatório Técnico</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3">
              <p className="text-xs font-medium text-blue-700 dark:text-blue-200">OS oficial do atendimento</p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                O sistema usa o template oficial interno e preenche a OS final com os dados do agendamento, relato técnico e assinaturas.
              </p>
              {currentGeneratedReport?.publicUrl && (
                <div className="mt-2">
                  <a href={resolveApiAssetUrl(currentGeneratedReport.publicUrl) ?? undefined} target="_blank" rel="noreferrer">
                    <Button type="button" variant="outline" className="w-full">Ver última OS preenchida</Button>
                  </a>
                </div>
              )}
            </div>
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-100">
              Revise e edite as considerações antes de enviar. Esse texto vai para a OS e para o Drive.
            </div>
            <Textarea
              className="min-h-36 text-base"
              placeholder="Considerações do técnico que aparecem para o cliente"
              value={report.summary}
              onChange={(e) => setReport({ summary: e.target.value })}
            />
            {canWriteInternalNote ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground">Anotações internas</p>
                <Textarea
                  className="min-h-24 text-base"
                  placeholder="Anotações internas do técnico"
                  value={internalNote}
                  onChange={(e) => setInternalNote(e.target.value)}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>
        )}

        {activeSection === 'DETAILS' && (
        <Card className="rounded-2xl">
          <CardHeader><CardTitle className="text-base sm:text-lg">Fotos, Vídeos e Documentos</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {isCarTrip && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                <p className="text-sm font-semibold text-amber-300">Controle obrigatório do veículo</p>
                <p className="mt-1 text-xs text-amber-100/90">
                  Primeiro envie as 4 fotos da retirada. Depois o sistema libera as considerações, os demais anexos e as assinaturas.
                </p>
                <div className="mt-3 rounded-lg border border-amber-400/20 bg-black/10 p-3 text-xs text-amber-50/90">
                  <p className="font-semibold">Fotos obrigatórias em cada etapa:</p>
                  <ol className="mt-2 list-decimal space-y-1 pl-4">
                    <li>Banco traseiro mostrando também o chão.</li>
                    <li>Banco dianteiro mostrando também o painel.</li>
                    <li>Lateral externa do veículo.</li>
                    <li>Odômetro mostrando a quilometragem.</li>
                  </ol>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3">
                  <label className="space-y-2">
                    <span className="text-sm font-medium">Quilometragem na retirada</span>
                    <Input
                      type="number"
                      min={current.vehicle?.mileage ?? 0}
                      inputMode="numeric"
                      placeholder={`KM atual: ${current.vehicle?.mileage ?? 0}`}
                      value={pickupMileage}
                      onChange={(event) => setPickupMileage(event.target.value)}
                    />
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      setErrorMessage('');
                      try {
                        await saveVehicleMileage('pickup');
                        setMessage('Quilometragem de retirada salva.');
                        await load(true);
                      } catch (err) {
                        setErrorMessage(err instanceof Error ? err.message : 'Não foi possível salvar a quilometragem.');
                      }
                    }}
                  >
                    {current.vehiclePickupMileage != null ? 'Atualizar KM de retirada' : 'Salvar KM de retirada'}
                  </Button>
                  <label className="flex min-h-20 cursor-pointer items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-background/70 px-4 py-3 text-left">
                    <div>
                      <p className="text-sm font-medium">Fotos de retirada do veículo</p>
                      <p className="text-xs text-muted-foreground">
                        {pickupVehiclePhotos.length >= VEHICLE_PHOTOS_REQUIRED
                          ? `${pickupVehiclePhotos.length} foto(s) enviada(s)`
                          : `${pickupVehiclePhotos.length}/${VEHICLE_PHOTOS_REQUIRED} fotos enviadas`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={pickupVehiclePhotosComplete ? 'default' : 'secondary'}>
                        {pickupVehiclePhotosComplete ? 'Completo' : uploadingVehicleStage === 'pickup' ? 'Enviando' : 'Enviar fotos'}
                      </Badge>
                      <Camera className="h-5 w-5" />
                    </div>
                    <Input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      disabled={uploadingVehicleStage !== null}
                      onChange={(e) => {
                        uploadVehiclePhotos(e.target.files, 'pickup').catch(() => undefined);
                        e.currentTarget.value = '';
                      }}
                    />
                  </label>
                  {pickupVehiclePhotosComplete && technicalReportSubmitted && (
                  <div className="space-y-3">
                  <label className="block space-y-2">
                    <span className="text-sm font-medium">Quilometragem na devolução</span>
                    <Input
                      type="number"
                      min={Number(pickupMileage || 0)}
                      inputMode="numeric"
                      placeholder="KM do painel ao devolver"
                      value={returnMileage}
                      onChange={(event) => setReturnMileage(event.target.value)}
                    />
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      setErrorMessage('');
                      try {
                        await saveVehicleMileage('return');
                        setMessage('Quilometragem de devolução salva e veículo atualizado.');
                        await load(true);
                      } catch (err) {
                        setErrorMessage(err instanceof Error ? err.message : 'Não foi possível salvar a quilometragem.');
                      }
                    }}
                  >
                    {current.vehicleReturnMileage != null ? 'Atualizar KM de devolução' : 'Salvar KM de devolução'}
                  </Button>
                  <label className="flex min-h-20 cursor-pointer items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-background/70 px-4 py-3 text-left">
                    <div>
                      <p className="text-sm font-medium">Fotos de devolução do veículo</p>
                      <p className="text-xs text-muted-foreground">
                        {returnVehiclePhotos.length >= VEHICLE_PHOTOS_REQUIRED
                          ? `${returnVehiclePhotos.length} foto(s) enviada(s)`
                          : `${returnVehiclePhotos.length}/${VEHICLE_PHOTOS_REQUIRED} fotos enviadas`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={returnVehiclePhotosComplete ? 'default' : 'secondary'}>
                        {returnVehiclePhotosComplete ? 'Completo' : uploadingVehicleStage === 'return' ? 'Enviando' : 'Obrigatórias ao finalizar'}
                      </Badge>
                      <Camera className="h-5 w-5" />
                    </div>
                    <Input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      disabled={uploadingVehicleStage !== null}
                      onChange={(e) => {
                        uploadVehiclePhotos(e.target.files, 'return').catch(() => undefined);
                        e.currentTarget.value = '';
                      }}
                    />
                  </label>
                  </div>
                  )}
                  {pickupVehiclePhotosComplete && !technicalReportSubmitted && (
                    <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-100">
                      Envie primeiro o relatório técnico, os anexos e as assinaturas. Depois a devolução do veículo será liberada.
                    </div>
                  )}
                </div>
              </div>
            )}
            {isCarTrip && !pickupVehiclePhotosComplete && (
              <div className="rounded-xl border border-dashed border-amber-500/40 p-4 text-center text-sm text-muted-foreground">
                As considerações técnicas, os outros arquivos e as assinaturas serão liberados depois do envio das 4 fotos de retirada.
              </div>
            )}
            {(!isCarTrip || pickupVehiclePhotosComplete) && (
            <>
            <div className="grid grid-cols-2 gap-3">
            <label className="flex h-20 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border text-foreground">
              <Camera className="h-5 w-5" />
              <span className="text-xs">Câmera</span>
              <Input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { addAttachment(e.target.files?.[0], 'midia-tecnica'); e.currentTarget.value = ''; }} />
            </label>
            <label className="flex h-20 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border text-foreground">
              <Video className="h-5 w-5" />
              <span className="text-xs">Vídeo</span>
              <Input type="file" accept="video/*" capture="environment" className="hidden" onChange={(e) => { addAttachment(e.target.files?.[0], 'midia-tecnica'); e.currentTarget.value = ''; }} />
            </label>
            <label className="flex h-20 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border text-foreground">
              <Camera className="h-5 w-5" />
              <span className="text-xs">Galeria</span>
              <Input type="file" multiple accept="image/*,video/*,.jpg,.jpeg,.png,.webp,.heic,.heif,.mp4,.mov,.webm" className="hidden" onChange={(e) => { addAttachments(e.target.files, 'midia-tecnica'); e.currentTarget.value = ''; }} />
            </label>
            <label className="flex h-20 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border text-foreground">
              <FileText className="h-5 w-5" />
              <span className="text-xs">Documento</span>
              <Input type="file" multiple accept=".doc,.docx,.xls,.xlsx,.txt,image/*,video/*" className="hidden" onChange={(e) => { addAttachments(e.target.files, 'documento-tecnico'); e.currentTarget.value = ''; }} />
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
                      <p className="text-[11px] text-muted-foreground">
                        {item.category === 'car-pickup-photo'
                          ? 'Foto de retirada do veículo'
                          : item.category === 'car-return-photo'
                            ? 'Foto de devolução do veículo'
                            : item.type === 'documento-tecnico'
                              ? 'Documento técnico'
                              : 'Mídia técnica'}
                      </p>
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
            <p className="text-xs text-muted-foreground">
              Fotos, vídeos e documentos enviados aqui também seguem para a pasta do atendimento no Google Drive.
            </p>
            </>
            )}
          </CardContent>
        </Card>
        )}


        {activeSection === 'DETAILS' && (!isCarTrip || pickupVehiclePhotosComplete) && (
        <Card className="rounded-2xl">
          <CardHeader><CardTitle className="text-base sm:text-lg">Assinaturas</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-3">
              <p className="text-sm font-medium">Assinatura do técnico</p>
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
                Limpar assinatura do técnico
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="min-h-11 w-full whitespace-normal px-3 py-2 text-center text-sm leading-tight"
                onClick={saveTechnicianSignatureToProfile}
              >
                Salvar assinatura do tecnico
              </Button>
              {savedTechnicianSignature && (
                <p className="text-center text-xs text-muted-foreground">
                  Assinatura salva carregada automaticamente.
                </p>
              )}
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

        {activeSection === 'DETAILS' && (!isCarTrip || pickupVehiclePhotosComplete) && (
        technicalReportSubmitted ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center text-sm text-emerald-300">
              {isCarTrip
                ? 'Relatório técnico enviado ao Drive. O atendimento permanece aberto até a devolução do veículo.'
                : 'Relatório técnico enviado ao Drive e atendimento finalizado.'}
            </div>
            {pendingAttachments.length > 0 && (
              <Button
                className="h-12 w-full rounded-xl bg-[#c8142f] hover:bg-[#a81027]"
                disabled={savingReport}
                onClick={uploadPendingAttachmentsOnly}
              >
                {savingReport ? 'Enviando arquivos...' : `Enviar somente ${pendingAttachments.length} anexo(s) pendente(s)`}
              </Button>
            )}
          </div>
        ) : (
          <Button className="h-12 w-full rounded-xl bg-[#c8142f] hover:bg-[#a81027]" disabled={!canSendReport} onClick={saveReport}>
            {savingReport ? 'Enviando...' : `Enviar relatório técnico${pendingAttachments.length ? ` + ${pendingAttachments.length} anexo(s)` : ''}`}
          </Button>
        )
        )}

        {message && <p className="text-center text-sm text-green-600 dark:text-green-400">{message}</p>}
        {errorMessage && <p className="text-center text-sm text-red-600 dark:text-red-400">{errorMessage}</p>}

        {activeSection === 'DETAILS' && (
        <Card className="rounded-2xl">
          <CardHeader><CardTitle className="text-base sm:text-lg">Próximos Atendimentos</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {upcoming.length === 0 && <p className="text-sm text-muted-foreground">Sem próximos atendimentos.</p>}
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

      </div>
    </div>
  );
}
