import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Calendar, Car, CheckCircle, Clock, FileText, Hotel, MapPin, Navigation, Route, User } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { ApiError, api, connectRealtime, parseServiceOrderPdf, resolveApiAssetUrl } from '../services/api';
import { calculateBrowserLogisticsSuggestion } from '../services/googleMapsBrowser';
import type { Appointment, Technician, Vehicle } from '../services/types';
import { formatDate, formatTime, statusLabel, statusTone } from '../services/types';

type ChecklistKey =
  | 'clientConfirmed'
  | 'contactConfirmed'
  | 'addressConfirmed'
  | 'serviceTypeConfirmed'
  | 'technicianSelected'
  | 'technicianAvailability'
  | 'dateTimeConfirmed'
  | 'hotelNeedChecked'
  | 'transportNeedChecked'
  | 'osChecked'
  | 'clientChecklistChecked';

const COMPANY_BASE_ADDRESS = 'R. Reinaldo Raulino dos Santos, 107 - Eden, Sorocaba - SP, 18086-796';

function toValidDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function safeDateInputValue(value?: string | null) {
  return toValidDate(value)?.toISOString().slice(0, 10) ?? '';
}

function safeTimeInputValue(value?: string | null) {
  const date = toValidDate(value);
  return date ? date.toTimeString().slice(0, 5) : '';
}

function safeDateTimeLocalValue(value?: string | null) {
  return toValidDate(value)?.toISOString().slice(0, 16) ?? '';
}

function safeLocaleDateTime(value?: string | null) {
  const date = toValidDate(value);
  return date ? date.toLocaleString('pt-BR') : 'Nao informado';
}

function normalizeCityForMaps(city?: string | null) {
  return String(city ?? '')
    .replace(/\s*\/\s*/g, ', ')
    .replace(/\s+-\s+/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildMapsDestination(address?: string | null, city?: string | null) {
  return [address?.trim(), normalizeCityForMaps(city), 'Brasil']
    .filter(Boolean)
    .join(', ');
}

const checklistLabels: Record<ChecklistKey, string> = {
  clientConfirmed: 'Cliente confirmado',
  contactConfirmed: 'Contato confirmado',
  addressConfirmed: 'Endereco confirmado',
  serviceTypeConfirmed: 'Tipo de servico confirmado',
  technicianSelected: 'Tecnico selecionado',
  technicianAvailability: 'Disponibilidade do tecnico',
  dateTimeConfirmed: 'Data e horario confirmados',
  hotelNeedChecked: 'Necessidade de hotel conferida',
  transportNeedChecked: 'Necessidade de transporte conferida',
  osChecked: 'OS criada',
  clientChecklistChecked: 'Checklist cliente recebido'
};

type LogisticsSuggestion = {
  ok: boolean;
  distanceText: string | null;
  durationText: string | null;
  durationSeconds: number | null;
  suggestedMode: 'CAR' | 'AIR' | null;
  suggestedReason: string | null;
  nearestAirport: {
    name: string | null;
    formattedAddress: string | null;
    distanceText: string | null;
  } | null;
};

export default function AppointmentDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const autoEditHandledRef = useRef(false);
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [serviceOrderImporting, setServiceOrderImporting] = useState(false);
  const [serviceOrderImportMessage, setServiceOrderImportMessage] = useState('');
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [rescheduleDialogOpen, setRescheduleDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    clientName: '',
    clientCnpj: '',
    clientIe: '',
    clientEmail: '',
    clientPhone: '',
    city: '',
    clientState: '',
    clientDistrict: '',
    clientZipCode: '',
    fullAddress: '',
    serviceType: '',
    problemDescription: '',
    serviceCode: '',
    serviceItemDescription: '',
    machineCode: '',
    machineName: '',
    machineModel: '',
    machineSerial: '',
    machineManufacturer: '',
    machineObservations: '',
    notes: '',
    osNumber: '',
    date: '',
    startTime: '',
    daysOut: '1',
    technicianId: '',
    transportMode: 'CAR',
    vehicleId: '',
    flightAirport: '',
    flightDepartureAt: '',
    flightReturnAt: '',
    hasHotel: false,
    hotelName: '',
    hotelAddress: '',
    hotelCheckIn: '',
    hotelCheckOut: '',
    hotelDailyRate: '',
    hotelNotes: ''
  });
  const [checkForm, setCheckForm] = useState<Record<ChecklistKey, boolean>>({
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
  });
  const [travelEstimate, setTravelEstimate] = useState<{ distanceText: string; durationText: string } | null>(null);
  const [logisticsSuggestion, setLogisticsSuggestion] = useState<LogisticsSuggestion | null>(null);
  const [travelLoading, setTravelLoading] = useState(false);
  const [logisticsError, setLogisticsError] = useState('');
  async function load(showLoading = true) {
    if (!id) {
      setAppointment(null);
      return;
    }
    if (showLoading) setLoading(true);
    try {
      const [item, techs, cars] = await Promise.all([
        api<Appointment>(`/appointments/${id}`),
        api<Technician[]>('/technicians'),
        api<Vehicle[]>('/resources/vehicles')
      ]);
      setAppointment(item);
      setTechnicians(techs.filter((t) => t.active));
      setVehicles(cars);
    } catch (err) {
      if (showLoading || !appointment) {
        setError(err instanceof ApiError ? err.message : 'Erro ao carregar atendimento');
        setAppointment(null);
      }
    } finally {
      if (showLoading) setLoading(false);
    }
  }

  useEffect(() => {
    load(true);
  }, [id]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (editing || saving) return;
      load(false);
    }, 3000);
    return () => clearInterval(timer);
  }, [id, editing, saving]);

  useEffect(() => {
    const disconnect = connectRealtime(() => {
      if (editing || saving) return;
      load(false);
    });
    return () => disconnect();
  }, [editing, saving, id]);

  useEffect(() => {
    if (!appointment) return;
    if (editing) return;
    setForm({
      clientName: appointment.client?.name ?? '',
      clientCnpj: appointment.client?.cnpj ?? '',
      clientIe: appointment.client?.ie ?? '',
      clientEmail: appointment.client?.email ?? '',
      clientPhone: appointment.client?.phone ?? '',
      city: appointment.city ?? '',
      clientState: appointment.client?.state ?? '',
      clientDistrict: appointment.client?.district ?? '',
      clientZipCode: appointment.client?.zipCode ?? '',
      fullAddress: appointment.fullAddress ?? '',
      serviceType: appointment.serviceType ?? '',
      problemDescription: appointment.problemDescription ?? '',
      serviceCode: appointment.serviceCode ?? '',
      serviceItemDescription: appointment.serviceItemDescription ?? '',
      machineCode: appointment.machineCode ?? '',
      machineName: appointment.machineName ?? '',
      machineModel: appointment.machineModel ?? '',
      machineSerial: appointment.machineSerial ?? '',
      machineManufacturer: appointment.machineManufacturer ?? '',
      machineObservations: appointment.machineObservations ?? '',
      notes: appointment.notes ?? '',
      osNumber: appointment.osNumber ?? '',
      date: safeDateInputValue(appointment.date),
      startTime: safeTimeInputValue(appointment.startTime),
      daysOut: String(appointment.daysOut ?? 1),
      technicianId: appointment.technicianId ?? '',
      transportMode: appointment.transportMode ?? (appointment.vehicle ? 'CAR' : 'NONE'),
      vehicleId: appointment.vehicle?.id ?? '',
      flightAirport: appointment.flightAirport ?? '',
      flightDepartureAt: safeDateTimeLocalValue(appointment.flightDepartureAt),
      flightReturnAt: safeDateTimeLocalValue(appointment.flightReturnAt),
      hasHotel: Boolean(appointment.hasHotel || appointment.hotelName || appointment.hotelAddress || appointment.hotelCheckIn || appointment.hotelCheckOut),
      hotelName: appointment.hotelName ?? '',
      hotelAddress: appointment.hotelAddress ?? '',
      hotelCheckIn: safeDateTimeLocalValue(appointment.hotelCheckIn),
      hotelCheckOut: safeDateTimeLocalValue(appointment.hotelCheckOut),
      hotelDailyRate: appointment.hotelDailyRate ?? '',
      hotelNotes: appointment.hotelNotes ?? ''
    });
    setCheckForm({
      clientConfirmed: appointment.schedulingChecklist?.clientConfirmed ?? false,
      contactConfirmed: appointment.schedulingChecklist?.contactConfirmed ?? false,
      addressConfirmed: appointment.schedulingChecklist?.addressConfirmed ?? false,
      serviceTypeConfirmed: appointment.schedulingChecklist?.serviceTypeConfirmed ?? false,
      technicianSelected: appointment.schedulingChecklist?.technicianSelected ?? false,
      technicianAvailability: appointment.schedulingChecklist?.technicianAvailability ?? false,
      dateTimeConfirmed: appointment.schedulingChecklist?.dateTimeConfirmed ?? false,
      hotelNeedChecked: appointment.schedulingChecklist?.hotelNeedChecked ?? false,
      transportNeedChecked: appointment.schedulingChecklist?.transportNeedChecked ?? false,
      osChecked: appointment.schedulingChecklist?.osChecked ?? false,
      clientChecklistChecked: appointment.schedulingChecklist?.clientChecklistChecked ?? false
    });
  }, [appointment, editing]);

  useEffect(() => {
    if (!appointment || autoEditHandledRef.current) return;
    if (searchParams.get('editing') !== '1') return;
    autoEditHandledRef.current = true;
    setEditing(true);
    navigate(`/appointments/${appointment.id}`, { replace: true });
  }, [appointment, navigate, searchParams]);

  useEffect(() => {
    const fullAddress = editing ? form.fullAddress : appointment?.fullAddress;
    const city = editing ? form.city : appointment?.city;
    const destination = buildMapsDestination(fullAddress, city);
    if (destination.length < 6) {
      setTravelEstimate(null);
      setLogisticsSuggestion(null);
      setLogisticsError('');
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setTravelLoading(true);
        setLogisticsError('');
        const browserKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
        let route: LogisticsSuggestion | null = null;
        try {
          route = await api<LogisticsSuggestion>(
            `/maps/logistics-suggestion?origin=${encodeURIComponent(COMPANY_BASE_ADDRESS)}&destination=${encodeURIComponent(destination)}`
          );
          if (!route.ok && browserKey) {
            route = await calculateBrowserLogisticsSuggestion(browserKey, COMPANY_BASE_ADDRESS, destination) as LogisticsSuggestion;
          }
        } catch (backendErr) {
          if (!browserKey) throw backendErr;
          route = await calculateBrowserLogisticsSuggestion(browserKey, COMPANY_BASE_ADDRESS, destination) as LogisticsSuggestion;
        }
        setLogisticsSuggestion(route);
        if (route.ok && route.distanceText && route.durationText) {
          setTravelEstimate({ distanceText: route.distanceText, durationText: route.durationText });
          if (editing) {
            setForm((prev) => {
              const airportLabel =
                route.nearestAirport?.name && route.nearestAirport?.formattedAddress
                  ? `${route.nearestAirport.name} - ${route.nearestAirport.formattedAddress}`
                  : route.nearestAirport?.name || route.nearestAirport?.formattedAddress || '';
              const nextTransportMode = route.suggestedMode ?? prev.transportMode;
              const nextFlightAirport =
                nextTransportMode === 'AIR' ? airportLabel || prev.flightAirport : '';
              if (prev.transportMode === nextTransportMode && prev.flightAirport === nextFlightAirport) {
                return prev;
              }
              return {
                ...prev,
                transportMode: nextTransportMode,
                flightAirport: nextFlightAirport
              };
            });
          }
        } else {
          setTravelEstimate(null);
          setLogisticsSuggestion(null);
          setLogisticsError('Nao foi possivel calcular a sugestao automatica para esse endereco. Confira cidade, endereco e integracao do Google Maps.');
        }
      } catch (err) {
        setTravelEstimate(null);
        setLogisticsSuggestion(null);
        setLogisticsError(err instanceof Error ? err.message : 'Falha ao calcular a sugestao automatica de viagem.');
      } finally {
        setTravelLoading(false);
      }
    }, 450);

    return () => clearTimeout(timer);
  }, [editing, form.fullAddress, form.city, appointment?.fullAddress, appointment?.city]);

  const logisticsDestination = buildMapsDestination(
    editing ? form.fullAddress : appointment?.fullAddress,
    editing ? form.city : appointment?.city
  );
  const nearestAirportLabel = logisticsSuggestion?.nearestAirport
    ? [
        logisticsSuggestion.nearestAirport.name,
        logisticsSuggestion.nearestAirport.formattedAddress,
        logisticsSuggestion.nearestAirport.distanceText ? `${logisticsSuggestion.nearestAirport.distanceText} do cliente` : ''
      ]
        .filter(Boolean)
        .join(' - ')
    : '';
  const shouldShowLogisticsStatus = logisticsDestination.length >= 6;
  const airportDestination = logisticsSuggestion?.suggestedMode === 'AIR'
    ? [logisticsSuggestion.nearestAirport?.name, logisticsSuggestion.nearestAirport?.formattedAddress].filter(Boolean).join(', ')
    : '';
  const effectiveRouteDestination = airportDestination || logisticsDestination;
  const routeExternalUrl = effectiveRouteDestination
    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(COMPANY_BASE_ADDRESS)}&destination=${encodeURIComponent(effectiveRouteDestination)}&travelmode=driving`
    : '';
  const googleMapsKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  const routeEmbedUrl = effectiveRouteDestination && googleMapsKey
    ? `https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(googleMapsKey)}&origin=${encodeURIComponent(COMPANY_BASE_ADDRESS)}&destination=${encodeURIComponent(effectiveRouteDestination)}&mode=driving`
    : '';
  const checklist = useMemo(
    () =>
      Object.entries(checklistLabels).map(([key, label]) => ({
        key: key as ChecklistKey,
        label,
        done: checkForm[key as ChecklistKey]
      })),
    [checkForm]
  );

  const checklistProgress = checklist.length ? (checklist.filter((item) => item.done).length / checklist.length) * 100 : 0;
  const generatedReports = (appointment?.attachments ?? []).filter((attachment) => attachment.kind === 'TECHNICAL_REPORT');

  async function handleServiceOrderImport(file?: File | null) {
    if (!file) return;
    setServiceOrderImporting(true);
    setServiceOrderImportMessage('');
    try {
      const result = await parseServiceOrderPdf(file, { analyzeWithAi: true });
      if (!result.found) {
        setServiceOrderImportMessage('Nao encontrei dados reconheciveis nesse PDF. Confira se ele veio do Sige Cloud.');
        return;
      }

      const fields = result.fields;
      setForm((prev) => ({
        ...prev,
        clientName: fields.clientName || prev.clientName,
        clientCnpj: fields.clientCnpj || prev.clientCnpj,
        clientIe: fields.clientIe || prev.clientIe,
        clientEmail: fields.clientEmail || prev.clientEmail,
        clientPhone: fields.clientPhone || prev.clientPhone,
        city: fields.clientCity || prev.city,
        clientState: fields.clientState || prev.clientState,
        clientDistrict: fields.clientDistrict || prev.clientDistrict,
        clientZipCode: fields.clientZipCode || prev.clientZipCode,
        fullAddress: fields.clientAddress || prev.fullAddress,
        serviceType: fields.serviceType || prev.serviceType,
        osNumber: fields.osNumber || prev.osNumber,
        serviceCode: fields.serviceCode || prev.serviceCode,
        serviceItemDescription: fields.serviceItemDescription || prev.serviceItemDescription,
        machineCode: fields.machineCode || prev.machineCode,
        machineName: fields.machineName || prev.machineName,
        machineModel: fields.machineModel || prev.machineModel,
        machineSerial: fields.machineSerial || prev.machineSerial,
        machineManufacturer: fields.machineManufacturer || prev.machineManufacturer,
        machineObservations: fields.machineObservations || prev.machineObservations,
        problemDescription: prev.problemDescription || fields.problemDescription || prev.problemDescription
      }));
      const sourceMessage = result.aiUsed
        ? 'IA analisou a OS e preencheu os campos. Confira antes de salvar.'
        : result.aiAvailable
          ? 'A IA nao conseguiu melhorar a leitura; usei o parser de reserva. Confira os campos.'
          : 'Dados importados pelo parser. Para usar IA, configure OPENAI_API_KEY no backend.';
      setServiceOrderImportMessage(sourceMessage);
    } catch (err) {
      setServiceOrderImportMessage(err instanceof ApiError ? err.message : 'Erro ao importar a OS.');
    } finally {
      setServiceOrderImporting(false);
    }
  }

  async function cancelAppointment() {
    if (!appointment) return;
    if (!cancelReason.trim()) {
      setError('Informe o motivo do cancelamento.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api(`/appointments/${appointment.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: cancelReason.trim() })
      });
      setCancelDialogOpen(false);
      setCancelReason('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel cancelar.');
    } finally {
      setSaving(false);
    }
  }

  async function rescheduleAppointment() {
    if (!appointment) return;
    if (!rescheduleDate || !rescheduleTime || !rescheduleReason.trim()) {
      setError('Preencha data, horario e motivo do reagendamento.');
      return;
    }
    const start = new Date(`${rescheduleDate}T${rescheduleTime}:00`);
    const end = new Date(start);
    end.setHours(end.getHours() + 2);

    setSaving(true);
    setError('');
    try {
      await api(`/appointments/${appointment.id}/reschedule`, {
        method: 'POST',
        body: JSON.stringify({
          date: new Date(`${rescheduleDate}T12:00:00`).toISOString(),
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          reason: rescheduleReason.trim()
        })
      });
      setRescheduleDialogOpen(false);
      setRescheduleReason('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel reagendar.');
    } finally {
      setSaving(false);
    }
  }

  async function saveEdition() {
    if (!appointment) return;
    if (!form.clientName.trim() || !form.city.trim() || !form.fullAddress.trim()) {
      setError('Preencha ao menos cliente, cidade e endereco.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const start = new Date(`${form.date}T${form.startTime}:00`);
      const end = new Date(start);
      end.setHours(end.getHours() + 2);

      await Promise.all([
        api(`/clients/${appointment.clientId}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: form.clientName,
            cnpj: form.clientCnpj || null,
            ie: form.clientIe || null,
            email: form.clientEmail || null,
            phone: form.clientPhone || null,
            city: form.city,
            state: form.clientState || null,
            district: form.clientDistrict || null,
            zipCode: form.clientZipCode || null,
            address: form.fullAddress
          })
        }),
        api(`/appointments/${appointment.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            technicianId: form.technicianId || null,
            vehicleId: form.transportMode === 'CAR' ? form.vehicleId || null : null,
            machineCode: form.machineCode || null,
            machineName: form.machineName || null,
            machineModel: form.machineModel || null,
            machineSerial: form.machineSerial || null,
            machineManufacturer: form.machineManufacturer || null,
            machineObservations: form.machineObservations || null,
            transportMode: form.transportMode || null,
            flightAirport: form.transportMode === 'AIR' ? form.flightAirport || null : null,
            flightDepartureAt: form.transportMode === 'AIR' && form.flightDepartureAt ? new Date(form.flightDepartureAt).toISOString() : null,
            flightReturnAt: form.transportMode === 'AIR' && form.flightReturnAt ? new Date(form.flightReturnAt).toISOString() : null,
            hasHotel: form.hasHotel,
            hotelName: form.hasHotel ? form.hotelName || null : null,
            hotelAddress: form.hasHotel ? form.hotelAddress || null : null,
            hotelCheckIn: form.hasHotel && form.hotelCheckIn ? new Date(form.hotelCheckIn).toISOString() : null,
            hotelCheckOut: form.hasHotel && form.hotelCheckOut ? new Date(form.hotelCheckOut).toISOString() : null,
            hotelDailyRate: form.hasHotel ? form.hotelDailyRate || null : null,
            hotelNotes: form.hasHotel ? form.hotelNotes || null : null,
            city: form.city,
            fullAddress: form.fullAddress,
            serviceType: form.serviceType || 'Pendente definicao',
            serviceCode: form.serviceCode || null,
            serviceItemDescription: form.serviceItemDescription || null,
            problemDescription: form.problemDescription || 'Pendente descricao do servico',
            notes: form.notes,
            osNumber: form.osNumber || null,
            daysOut: Number(form.daysOut || 1),
            needsHotel: form.hasHotel,
            needsTransport: form.transportMode !== 'NONE',
            date: new Date(`${form.date}T12:00:00`).toISOString(),
            startTime: start.toISOString(),
            endTime: end.toISOString()
          })
        }),
        api(`/appointments/${appointment.id}/checklist`, {
          method: 'POST',
          body: JSON.stringify(checkForm)
        })
      ]);

      setEditing(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel salvar as alteracoes.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmAppointment() {
    if (!appointment) return;
    setSaving(true);
    setError('');
    try {
      await api(`/appointments/${appointment.id}/confirm`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel confirmar o agendamento.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="p-6">Carregando atendimento...</div>;
  }

  if (!appointment) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Voltar
        </Button>
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">Atendimento nao encontrado.</CardContent>
        </Card>
      </div>
    );
  }

  const defaultDate = safeDateInputValue(appointment.date);
  const defaultTime = safeTimeInputValue(appointment.startTime);

  function openRescheduleDialog() {
    setRescheduleDate(defaultDate);
    setRescheduleTime(defaultTime);
    setRescheduleReason('');
    setRescheduleDialogOpen(true);
    setError('');
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <Button variant="ghost" onClick={() => navigate(-1)} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Voltar
        </Button>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold mb-2">{appointment.client?.name ?? 'Cliente'}</h1>
            <div className="flex items-center gap-3">
              <Badge className={statusTone(appointment.status).color}>{statusLabel(appointment.status)}</Badge>
              <span className="text-sm text-muted-foreground">Agendamento #{appointment.id}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => (editing ? saveEdition() : setEditing(true))} disabled={saving}>
              {editing ? (saving ? 'Salvando...' : 'Salvar') : 'Editar'}
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              onClick={confirmAppointment}
              disabled={saving || appointment.status === 'READY' || checklistProgress < 100}
            >
              Confirmar agendamento
            </Button>
            <Button variant="outline" onClick={openRescheduleDialog} disabled={saving}>
              Reagendar
            </Button>
            <Button variant="outline" className="border-red-500 text-red-500" onClick={() => setCancelDialogOpen(true)} disabled={saving}>
              Cancelar
            </Button>
            {appointment.latitude && appointment.longitude && (
              <a href={`https://www.google.com/maps/dir/?api=1&destination=${appointment.latitude},${appointment.longitude}`} target="_blank" rel="noreferrer">
                <Button variant="outline">
                  <Navigation className="h-4 w-4 mr-2" />
                  Abrir rota
                </Button>
              </a>
            )}
          </div>
        </div>
        {error && <p className="text-sm text-red-500 mt-3">{error}</p>}
      </div>

      <Dialog open={rescheduleDialogOpen} onOpenChange={setRescheduleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reagendar atendimento</DialogTitle>
            <DialogDescription>Escolha nova data, horario e motivo.</DialogDescription>
          </DialogHeader>
          <div className="grid md:grid-cols-2 gap-3 py-2">
            <div>
              <label className="text-sm mb-1 block">Nova data</label>
              <Input type="date" value={rescheduleDate} onChange={(e) => setRescheduleDate(e.target.value)} />
            </div>
            <div>
              <label className="text-sm mb-1 block">Novo horario</label>
              <Input type="time" value={rescheduleTime} onChange={(e) => setRescheduleTime(e.target.value)} />
            </div>
            <div className="md:col-span-2">
              <label className="text-sm mb-1 block">Motivo</label>
              <Textarea value={rescheduleReason} onChange={(e) => setRescheduleReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRescheduleDialogOpen(false)}>
              Fechar
            </Button>
            <Button onClick={rescheduleAppointment} disabled={saving}>
              {saving ? 'Salvando...' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar atendimento</DialogTitle>
            <DialogDescription>Informe o motivo do cancelamento.</DialogDescription>
          </DialogHeader>
          <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>
              Fechar
            </Button>
            <Button className="bg-red-600 hover:bg-red-700" onClick={cancelAppointment} disabled={saving}>
              {saving ? 'Cancelando...' : 'Confirmar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5 text-blue-500" />
                Informacoes do cliente
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Nome</span>
                {editing ? <Input value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} className="mt-1" /> : <p className="font-medium">{appointment.client?.name ?? 'Nao informado'}</p>}
              </div>
              <div>
                <span className="text-muted-foreground">CNPJ</span>
                {editing ? <Input value={form.clientCnpj} onChange={(e) => setForm({ ...form, clientCnpj: e.target.value })} className="mt-1" /> : <p className="font-medium">{appointment.client?.cnpj ?? 'Nao informado'}</p>}
              </div>
              <div>
                <span className="text-muted-foreground">Email</span>
                {editing ? <Input value={form.clientEmail} onChange={(e) => setForm({ ...form, clientEmail: e.target.value })} className="mt-1" /> : <p className="font-medium">{appointment.client?.email ?? 'Nao informado'}</p>}
              </div>
              <div>
                <span className="text-muted-foreground">Telefone</span>
                {editing ? <Input value={form.clientPhone} onChange={(e) => setForm({ ...form, clientPhone: e.target.value })} className="mt-1" /> : <p className="font-medium">{appointment.client?.phone ?? 'Nao informado'}</p>}
              </div>
              <div>
                <span className="text-muted-foreground">IE</span>
                {editing ? <Input value={form.clientIe} onChange={(e) => setForm({ ...form, clientIe: e.target.value })} className="mt-1" /> : <p className="font-medium">{appointment.client?.ie ?? 'Nao informado'}</p>}
              </div>
              <div>
                <span className="text-muted-foreground">Bairro</span>
                {editing ? <Input value={form.clientDistrict} onChange={(e) => setForm({ ...form, clientDistrict: e.target.value })} className="mt-1" /> : <p className="font-medium">{appointment.client?.district ?? 'Nao informado'}</p>}
              </div>
              <div>
                <span className="text-muted-foreground">Estado</span>
                {editing ? <Input value={form.clientState} onChange={(e) => setForm({ ...form, clientState: e.target.value.toUpperCase() })} className="mt-1" /> : <p className="font-medium">{appointment.client?.state ?? 'Nao informado'}</p>}
              </div>
              <div>
                <span className="text-muted-foreground">CEP</span>
                {editing ? <Input value={form.clientZipCode} onChange={(e) => setForm({ ...form, clientZipCode: e.target.value })} className="mt-1" /> : <p className="font-medium">{appointment.client?.zipCode ?? 'Nao informado'}</p>}
              </div>
              <div>
                <span className="text-muted-foreground">Tipo de servico</span>
                {editing ? <Input value={form.serviceType} onChange={(e) => setForm({ ...form, serviceType: e.target.value })} className="mt-1" /> : <p className="font-medium">{appointment.serviceType || 'Pendente definicao'}</p>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-cyan-500" />
                Agendamento
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Data</p>
                {editing ? <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="mt-1" /> : <p className="font-medium">{formatDate(appointment.date)}</p>}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Horario</p>
                {editing ? <Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className="mt-1" /> : <p className="font-medium">{formatTime(appointment.startTime)}</p>}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Dias em campo</p>
                {editing ? (
                  <Input
                    type="number"
                    min="1"
                    value={form.daysOut}
                    onChange={(e) => setForm({ ...form, daysOut: e.target.value })}
                    className="mt-1"
                  />
                ) : (
                  <p className="font-medium">{appointment.daysOut ?? 1} dia(s)</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Tecnico</p>
                {editing ? (
                  <select className="w-full mt-1 h-9 rounded-md border bg-background px-3 text-sm" value={form.technicianId} onChange={(e) => setForm({ ...form, technicianId: e.target.value })}>
                    <option value="">Sem tecnico</option>
                    {technicians.map((tech) => (
                      <option key={tech.id} value={tech.id}>
                        {tech.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="font-medium">{appointment.technician?.name ?? 'Sem tecnico'}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Cidade</p>
                {editing ? <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="mt-1" /> : <p className="font-medium">{appointment.city}</p>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Car className="h-5 w-5 text-yellow-500" />
                Logistica
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Tipo de viagem</p>
                {editing ? (
                  <select className="w-full h-9 rounded-md border bg-background px-3 text-sm" value={form.transportMode} onChange={(e) => setForm({ ...form, transportMode: e.target.value })}>
                    <option value="NONE">Nao precisa de viagem</option>
                    <option value="CAR">Viagem de carro</option>
                    <option value="AIR">Viagem aerea</option>
                  </select>
                ) : (
                  <p className="text-sm">{appointment.transportMode === 'AIR' ? 'Viagem aerea' : appointment.transportMode === 'CAR' ? 'Viagem de carro' : 'Nao informado'}</p>
                )}
              </div>
              {((editing && form.transportMode === 'CAR') || (!editing && appointment.transportMode === 'CAR')) && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Veiculo</p>
                {editing ? (
                  <select className="w-full h-9 rounded-md border bg-background px-3 text-sm" value={form.vehicleId} onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}>
                    <option value="">Nao informado</option>
                    {vehicles.map((vehicle) => (
                      <option key={vehicle.id} value={vehicle.id}>
                        {vehicle.name} - {vehicle.plate}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-sm">{appointment.vehicle ? `${appointment.vehicle.name} - ${appointment.vehicle.plate}` : 'Nao informado'}</p>
                )}
              </div>
              )}
              {((editing && form.transportMode === 'AIR') || (!editing && appointment.transportMode === 'AIR')) && (
              <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
                <p className="text-xs text-muted-foreground">Dados do voo</p>
                {editing ? (
                  <>
                    <div className="space-y-1">
                      <p className="text-[11px] text-muted-foreground">Aeroporto mais proximo do cliente</p>
                      <Input
                        placeholder="Calculado automaticamente"
                        value={nearestAirportLabel}
                        readOnly
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="text-[11px] text-muted-foreground">Aeroporto usado na viagem</p>
                      <Input placeholder="Aeroporto/terminal da viagem" value={form.flightAirport} onChange={(e) => setForm({ ...form, flightAirport: e.target.value })} />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <p className="mb-1 text-[11px] text-muted-foreground">Ida - data e hora</p>
                        <Input type="datetime-local" value={form.flightDepartureAt} onChange={(e) => setForm({ ...form, flightDepartureAt: e.target.value })} />
                      </div>
                      <div>
                        <p className="mb-1 text-[11px] text-muted-foreground">Volta - data e hora</p>
                        <Input type="datetime-local" value={form.flightReturnAt} onChange={(e) => setForm({ ...form, flightReturnAt: e.target.value })} />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="space-y-1 text-sm">
                    <p>Aeroporto mais proximo do cliente: {nearestAirportLabel || appointment.flightAirport || 'Nao informado'}</p>
                    <p>Aeroporto da viagem: {appointment.flightAirport || 'Nao informado'}</p>
                    <p className="text-muted-foreground">Ida: {safeLocaleDateTime(appointment.flightDepartureAt)}</p>
                    <p className="text-muted-foreground">Volta: {safeLocaleDateTime(appointment.flightReturnAt)}</p>
                  </div>
                )}
              </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground mb-1">Hospedagem</p>
                {editing ? (
                  <div className="space-y-2">
                    <select className="w-full h-9 rounded-md border bg-background px-3 text-sm" value={form.hasHotel ? 'YES' : 'NO'} onChange={(e) => setForm({ ...form, hasHotel: e.target.value === 'YES' })}>
                      <option value="NO">Nao tem hospedagem</option>
                      <option value="YES">Tem hospedagem</option>
                    </select>
                    {form.hasHotel && (
                    <>
                    <Input placeholder="Nome do hotel" value={form.hotelName} onChange={(e) => setForm({ ...form, hotelName: e.target.value })} />
                    <Input placeholder="Endereco do hotel" value={form.hotelAddress} onChange={(e) => setForm({ ...form, hotelAddress: e.target.value })} />
                    <Input type="number" min="0" step="0.01" placeholder="Valor da hospedagem" value={form.hotelDailyRate} onChange={(e) => setForm({ ...form, hotelDailyRate: e.target.value })} />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <p className="mb-1 text-[11px] text-muted-foreground">Check-in</p>
                        <Input type="datetime-local" value={form.hotelCheckIn} onChange={(e) => setForm({ ...form, hotelCheckIn: e.target.value })} />
                      </div>
                      <div>
                        <p className="mb-1 text-[11px] text-muted-foreground">Check-out</p>
                        <Input type="datetime-local" value={form.hotelCheckOut} onChange={(e) => setForm({ ...form, hotelCheckOut: e.target.value })} />
                      </div>
                    </div>
                    <Textarea placeholder="Informacoes do hotel, reserva, observacoes ou regras do agendamento" value={form.hotelNotes} onChange={(e) => setForm({ ...form, hotelNotes: e.target.value })} />
                    </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1 text-sm">
                    <p>{appointment.hasHotel || appointment.hotelName ? 'Tem hospedagem' : 'Nao tem hospedagem'}</p>
                    {(appointment.hasHotel || appointment.hotelName) && <p>{appointment.hotelName || "Nao informado"}</p>}
                    {appointment.hotelAddress && <p className="text-muted-foreground">{appointment.hotelAddress}</p>}
                    {appointment.hotelDailyRate && <p className="text-muted-foreground">Valor: R$ {appointment.hotelDailyRate}</p>}
                    {appointment.hotelCheckIn && <p className="text-muted-foreground">Check-in: {safeLocaleDateTime(appointment.hotelCheckIn)}</p>}
                    {appointment.hotelCheckOut && <p className="text-muted-foreground">Check-out: {safeLocaleDateTime(appointment.hotelCheckOut)}</p>}
                    {appointment.hotelNotes && <p className="text-muted-foreground">{appointment.hotelNotes}</p>}
                  </div>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Endereco</p>
                {editing ? <Input value={form.fullAddress} onChange={(e) => setForm({ ...form, fullAddress: e.target.value })} /> : <p className="text-sm">{appointment.fullAddress}</p>}
                <div className="mt-3 space-y-3">
                  <p className="text-[11px] text-muted-foreground">Base fixa de saida: {COMPANY_BASE_ADDRESS}</p>
                  {travelLoading && <p className="text-xs text-muted-foreground">Calculando tempo de viagem...</p>}
                  {shouldShowLogisticsStatus && (
                    <div className={`rounded-md border p-3 ${
                      logisticsSuggestion?.suggestedMode
                        ? 'border-blue-500/20 bg-blue-500/10'
                        : logisticsError
                          ? 'border-amber-500/30 bg-amber-500/10'
                          : 'border-border bg-muted/20'
                    }`}>
                      <p className="text-sm font-semibold text-foreground">Sugestao de viagem</p>
                      {travelLoading && (
                        <p className="mt-1 text-xs text-muted-foreground">O sistema esta calculando automaticamente se a viagem deve ser de carro ou de aviao.</p>
                      )}
                      {!travelLoading && logisticsSuggestion?.suggestedMode && (
                        <>
                          <p className="mt-1 text-sm font-semibold text-blue-200">
                            Sugestao automatica: {logisticsSuggestion.suggestedMode === 'AIR' ? 'viagem aerea' : 'viagem de carro'}
                          </p>
                          {logisticsSuggestion.suggestedReason && (
                            <p className="mt-1 text-xs text-muted-foreground">{logisticsSuggestion.suggestedReason}</p>
                          )}
                          {logisticsSuggestion.nearestAirport && (
                            <div className="mt-2 text-xs text-muted-foreground">
                              <p>Aeroporto mais proximo: {logisticsSuggestion.nearestAirport.name || 'Nao identificado'}</p>
                              {logisticsSuggestion.nearestAirport.formattedAddress && (
                                <p>{logisticsSuggestion.nearestAirport.formattedAddress}</p>
                              )}
                              {logisticsSuggestion.nearestAirport.distanceText && (
                                <p>Distancia do cliente ate o aeroporto: {logisticsSuggestion.nearestAirport.distanceText}</p>
                              )}
                            </div>
                          )}
                        </>
                      )}
                      {!travelLoading && !logisticsSuggestion?.suggestedMode && logisticsError && (
                        <p className="mt-1 text-xs text-amber-200">{logisticsError}</p>
                      )}
                      {!travelLoading && !logisticsSuggestion?.suggestedMode && !logisticsError && (
                        <p className="mt-1 text-xs text-muted-foreground">Preencha o endereco completo e a cidade para o sistema gerar a sugestao automaticamente.</p>
                      )}
                    </div>
                  )}
                  {(travelEstimate || logisticsSuggestion?.nearestAirport) && (
                    <div className={`grid gap-2 ${logisticsSuggestion?.nearestAirport ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                      <div className="rounded-md border bg-muted/30 p-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock className="h-4 w-4" />
                          Tempo de carro
                        </div>
                        <p className="mt-1 text-sm font-semibold">{travelEstimate?.durationText ?? 'Nao calculado'}</p>
                      </div>
                      <div className="rounded-md border bg-muted/30 p-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Route className="h-4 w-4" />
                          Distancia da Metalique
                        </div>
                        <p className="mt-1 text-sm font-semibold">{travelEstimate?.distanceText ?? 'Nao calculado'}</p>
                      </div>
                      {logisticsSuggestion?.nearestAirport && (
                        <div className="rounded-md border bg-muted/30 p-3">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <MapPin className="h-4 w-4" />
                            Aeroporto sugerido
                          </div>
                          <p className="mt-1 text-sm font-semibold">{logisticsSuggestion.nearestAirport.name || 'Nao identificado'}</p>
                          {logisticsSuggestion.nearestAirport.distanceText && (
                            <p className="mt-1 text-xs text-muted-foreground">{logisticsSuggestion.nearestAirport.distanceText} do cliente</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {routeExternalUrl && (
                    <a href={routeExternalUrl} target="_blank" rel="noreferrer">
                      <Button type="button" variant="outline" className="w-full">
                        <Navigation className="mr-2 h-4 w-4" />
                        {logisticsSuggestion?.suggestedMode === 'AIR' ? 'Abrir rota ate o aeroporto' : 'Abrir rota no Google Maps'}
                      </Button>
                    </a>
                  )}
                  {routeEmbedUrl && (
                    <div className="overflow-hidden rounded-md border">
                      <iframe
                        title="Rota da Metalique ate o atendimento"
                        src={routeEmbedUrl}
                        className="h-56 w-full"
                        loading="lazy"
                        referrerPolicy="no-referrer-when-downgrade"
                      />
                    </div>
                  )}
                  {!routeEmbedUrl && logisticsDestination && (
                    <p className="text-xs text-muted-foreground">Mini mapa indisponivel: configure VITE_GOOGLE_MAPS_API_KEY no frontend.</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-blue-500" />
                Checklist
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">Progresso</span>
                  <span className="text-sm font-medium">{Math.round(checklistProgress)}%</span>
                </div>
                <Progress value={checklistProgress} />
              </div>
              <div className="space-y-2">
                {checklist.map((item) => (
                  <label key={item.key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-blue-600"
                      disabled={!editing}
                      checked={checkForm[item.key]}
                      onChange={(e) => setCheckForm((prev) => ({ ...prev, [item.key]: e.target.checked }))}
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-yellow-500" />
                Servico
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 mb-4">
                <Input value={form.serviceType} onChange={(e) => setForm({ ...form, serviceType: e.target.value })} disabled={!editing} />
                <Textarea value={form.problemDescription} onChange={(e) => setForm({ ...form, problemDescription: e.target.value })} disabled={!editing} />
                <Input value={form.osNumber} placeholder="OS" onChange={(e) => setForm({ ...form, osNumber: e.target.value })} disabled={!editing} />
                <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                  <div>
                    <p className="text-sm font-medium">Modelo oficial de OS</p>
                    <p className="text-xs text-muted-foreground">
                      Este agendamento usa apenas os templates oficiais internos. Preencha abaixo os dados do equipamento e do servico para gerar a OS final do tecnico.
                    </p>
                  </div>
                  {editing && (
                    <div className="mt-3 rounded-md border border-blue-500/20 bg-blue-500/5 p-3">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="text-sm font-medium text-blue-100">Analisar OS do Sige com IA</p>
                          <p className="text-xs text-muted-foreground">Anexe o PDF original para a IA separar servico, equipamento e relato nos campos corretos.</p>
                        </div>
                        <label className="inline-flex cursor-pointer items-center justify-center rounded-md border border-blue-500/30 px-4 py-2 text-sm font-semibold text-blue-100 hover:bg-blue-500/10">
                          {serviceOrderImporting ? 'Analisando...' : 'Analisar com IA'}
                          <Input
                            type="file"
                            accept="application/pdf"
                            disabled={serviceOrderImporting}
                            className="hidden"
                            onChange={(event) => {
                              void handleServiceOrderImport(event.target.files?.[0]);
                              event.target.value = '';
                            }}
                          />
                        </label>
                      </div>
                      {serviceOrderImportMessage && (
                        <p className="mt-2 text-xs text-blue-100">{serviceOrderImportMessage}</p>
                      )}
                    </div>
                  )}
                  <div className="mt-3 space-y-2">
                    {generatedReports.length > 0 && (
                      <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3">
                        <p className="text-xs font-medium text-emerald-300">OS preenchidas geradas</p>
                        <div className="mt-2 space-y-2">
                          {generatedReports.map((attachment) => (
                            <div key={attachment.id} className="flex items-center justify-between rounded-md border border-emerald-500/20 bg-background/60 px-3 py-2">
                              <span className="truncate text-sm">{attachment.originalName}</span>
                              {attachment.publicUrl && (
                                <a href={resolveApiAssetUrl(attachment.publicUrl) ?? undefined} target="_blank" rel="noreferrer">
                                  <Button type="button" variant="outline" size="sm">Abrir</Button>
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="rounded-xl border border-border/70 bg-muted/10 p-4 space-y-4">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">Servico na OS</p>
                    <p className="text-xs text-muted-foreground">Esses dados entram direto na ordem de servico final.</p>
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    <div className="min-w-0">
                      <p className="mb-1 text-[11px] text-muted-foreground">Codigo do servico</p>
                      <Input value={form.serviceCode} placeholder="Codigo do servico" onChange={(e) => setForm({ ...form, serviceCode: e.target.value })} disabled={!editing} className="w-full" />
                    </div>
                    <div className="min-w-0">
                      <p className="mb-1 text-[11px] text-muted-foreground">Descricao do servico na OS</p>
                      <Textarea value={form.serviceItemDescription} placeholder="Descricao do servico" onChange={(e) => setForm({ ...form, serviceItemDescription: e.target.value })} disabled={!editing} className="min-h-20 w-full" />
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border border-border/70 bg-muted/10 p-4 space-y-4">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold">Dados do equipamento</p>
                    <p className="text-xs text-muted-foreground">Organize aqui exatamente como o tecnico deve ver e como a OS deve sair.</p>
                  </div>
                  <div className="grid grid-cols-1 gap-3">
                    <div className="min-w-0">
                      <p className="mb-1 text-[11px] text-muted-foreground">Codigo do equipamento</p>
                      <Input value={form.machineCode} placeholder="Codigo do equipamento" onChange={(e) => setForm({ ...form, machineCode: e.target.value })} disabled={!editing} className="w-full" />
                    </div>
                    <div className="min-w-0">
                      <p className="mb-1 text-[11px] text-muted-foreground">Nome da maquina</p>
                      <Input value={form.machineName} placeholder="Nome da maquina" onChange={(e) => setForm({ ...form, machineName: e.target.value })} disabled={!editing} className="w-full" />
                    </div>
                    <div className="min-w-0">
                      <p className="mb-1 text-[11px] text-muted-foreground">Modelo da maquina</p>
                      <Textarea value={form.machineModel} placeholder="Modelo" onChange={(e) => setForm({ ...form, machineModel: e.target.value })} disabled={!editing} className="min-h-20 w-full" />
                    </div>
                    <div className="min-w-0">
                      <p className="mb-1 text-[11px] text-muted-foreground">Numero de serie</p>
                      <Input value={form.machineSerial} placeholder="Numero de serie" onChange={(e) => setForm({ ...form, machineSerial: e.target.value })} disabled={!editing} className="w-full" />
                    </div>
                    <div className="min-w-0">
                      <p className="mb-1 text-[11px] text-muted-foreground">Fabricante</p>
                      <Input value={form.machineManufacturer} placeholder="Fabricante" onChange={(e) => setForm({ ...form, machineManufacturer: e.target.value })} disabled={!editing} className="w-full" />
                    </div>
                  </div>
                  <div>
                    <p className="mb-1 text-[11px] text-muted-foreground">Observacoes do equipamento</p>
                    <Textarea value={form.machineObservations} placeholder="Observacoes do equipamento" onChange={(e) => setForm({ ...form, machineObservations: e.target.value })} disabled={!editing} className="min-h-24" />
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                <p className="text-xs text-amber-300 font-medium mb-1">Ponto de atencao</p>
                <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} disabled={!editing} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
