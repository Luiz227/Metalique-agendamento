import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Calendar, Car, CheckCircle, Clock, FileText, Hotel, MapPin, Navigation, Route, User } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { ApiError, api, connectRealtime } from '../services/api';
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

export default function AppointmentDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [rescheduleDialogOpen, setRescheduleDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    clientName: '',
    clientEmail: '',
    clientPhone: '',
    city: '',
    fullAddress: '',
    serviceType: '',
    problemDescription: '',
    notes: '',
    osNumber: '',
    date: '',
    startTime: '',
    technicianId: '',
    vehicleId: '',
    hotelName: '',
    hotelAddress: '',
    hotelCheckIn: '',
    hotelCheckOut: '',
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
  const [travelLoading, setTravelLoading] = useState(false);

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
      clientEmail: appointment.client?.email ?? '',
      clientPhone: appointment.client?.phone ?? '',
      city: appointment.city ?? '',
      fullAddress: appointment.fullAddress ?? '',
      serviceType: appointment.serviceType ?? '',
      problemDescription: appointment.problemDescription ?? '',
      notes: appointment.notes ?? '',
      osNumber: appointment.osNumber ?? '',
      date: new Date(appointment.date).toISOString().slice(0, 10),
      startTime: new Date(appointment.startTime).toTimeString().slice(0, 5),
      technicianId: appointment.technicianId ?? '',
      vehicleId: appointment.vehicle?.id ?? '',
      hotelName: appointment.hotelName ?? '',
      hotelAddress: appointment.hotelAddress ?? '',
      hotelCheckIn: appointment.hotelCheckIn ? new Date(appointment.hotelCheckIn).toISOString().slice(0, 16) : '',
      hotelCheckOut: appointment.hotelCheckOut ? new Date(appointment.hotelCheckOut).toISOString().slice(0, 16) : '',
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
    const fullAddress = editing ? form.fullAddress : appointment?.fullAddress;
    const city = editing ? form.city : appointment?.city;
    const destination = [fullAddress, city].filter(Boolean).join(' ').trim();
    if (destination.length < 6) {
      setTravelEstimate(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setTravelLoading(true);
        const route = await api<{ ok: boolean; distanceText: string | null; durationText: string | null }>(
          `/maps/travel-time?origin=${encodeURIComponent(COMPANY_BASE_ADDRESS)}&destination=${encodeURIComponent(destination)}`
        );
        if (route.ok && route.distanceText && route.durationText) {
          setTravelEstimate({ distanceText: route.distanceText, durationText: route.durationText });
        } else {
          setTravelEstimate(null);
        }
      } catch {
        setTravelEstimate(null);
      } finally {
        setTravelLoading(false);
      }
    }, 450);

    return () => clearTimeout(timer);
  }, [editing, form.fullAddress, form.city, appointment?.fullAddress, appointment?.city]);

  const logisticsDestination = [editing ? form.fullAddress : appointment?.fullAddress, editing ? form.city : appointment?.city]
    .filter(Boolean)
    .join(', ')
    .trim();
  const routeExternalUrl = logisticsDestination
    ? `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(COMPANY_BASE_ADDRESS)}&destination=${encodeURIComponent(logisticsDestination)}&travelmode=driving`
    : '';
  const googleMapsKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  const routeEmbedUrl = logisticsDestination && googleMapsKey
    ? `https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(googleMapsKey)}&origin=${encodeURIComponent(COMPANY_BASE_ADDRESS)}&destination=${encodeURIComponent(logisticsDestination)}&mode=driving`
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
            email: form.clientEmail || null,
            phone: form.clientPhone || null,
            city: form.city,
            address: form.fullAddress
          })
        }),
        api(`/appointments/${appointment.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            technicianId: form.technicianId || null,
            vehicleId: form.vehicleId || null,
            hotelName: form.hotelName || null,
            hotelAddress: form.hotelAddress || null,
            hotelCheckIn: form.hotelCheckIn ? new Date(form.hotelCheckIn).toISOString() : null,
            hotelCheckOut: form.hotelCheckOut ? new Date(form.hotelCheckOut).toISOString() : null,
            hotelNotes: form.hotelNotes || null,
            city: form.city,
            fullAddress: form.fullAddress,
            serviceType: form.serviceType || 'Pendente definicao',
            problemDescription: form.problemDescription || 'Pendente descricao do servico',
            notes: form.notes,
            osNumber: form.osNumber || null,
            needsHotel: Boolean(form.hotelName || form.hotelAddress || form.hotelCheckIn || form.hotelCheckOut),
            needsTransport: Boolean(form.vehicleId),
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

  const defaultDate = new Date(appointment.date).toISOString().slice(0, 10);
  const defaultTime = new Date(appointment.startTime).toTimeString().slice(0, 5);

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
                <span className="text-muted-foreground">Email</span>
                {editing ? <Input value={form.clientEmail} onChange={(e) => setForm({ ...form, clientEmail: e.target.value })} className="mt-1" /> : <p className="font-medium">{appointment.client?.email ?? 'Nao informado'}</p>}
              </div>
              <div>
                <span className="text-muted-foreground">Telefone</span>
                {editing ? <Input value={form.clientPhone} onChange={(e) => setForm({ ...form, clientPhone: e.target.value })} className="mt-1" /> : <p className="font-medium">{appointment.client?.phone ?? 'Nao informado'}</p>}
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
            <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Data</p>
                {editing ? <Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="mt-1" /> : <p className="font-medium">{formatDate(appointment.date)}</p>}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Horario</p>
                {editing ? <Input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className="mt-1" /> : <p className="font-medium">{formatTime(appointment.startTime)}</p>}
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
              <div>
                <p className="text-xs text-muted-foreground mb-1">Hotel</p>
                {editing ? (
                  <div className="space-y-2">
                    <Input placeholder="Nome do hotel" value={form.hotelName} onChange={(e) => setForm({ ...form, hotelName: e.target.value })} />
                    <Input placeholder="Endereco do hotel" value={form.hotelAddress} onChange={(e) => setForm({ ...form, hotelAddress: e.target.value })} />
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
                  </div>
                ) : (
                  <div className="space-y-1 text-sm">
                    <p>{appointment.hotelName || "Nao informado"}</p>
                    {appointment.hotelAddress && <p className="text-muted-foreground">{appointment.hotelAddress}</p>}
                    {appointment.hotelCheckIn && <p className="text-muted-foreground">Check-in: {new Date(appointment.hotelCheckIn).toLocaleString("pt-BR")}</p>}
                    {appointment.hotelCheckOut && <p className="text-muted-foreground">Check-out: {new Date(appointment.hotelCheckOut).toLocaleString("pt-BR")}</p>}
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
                  {travelEstimate && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-md border bg-muted/30 p-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Clock className="h-4 w-4" />
                          Tempo de carro
                        </div>
                        <p className="mt-1 text-sm font-semibold">{travelEstimate.durationText}</p>
                      </div>
                      <div className="rounded-md border bg-muted/30 p-3">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Route className="h-4 w-4" />
                          Distancia da Metalique
                        </div>
                        <p className="mt-1 text-sm font-semibold">{travelEstimate.distanceText}</p>
                      </div>
                    </div>
                  )}
                  {routeExternalUrl && (
                    <a href={routeExternalUrl} target="_blank" rel="noreferrer">
                      <Button type="button" variant="outline" className="w-full">
                        <Navigation className="mr-2 h-4 w-4" />
                        Abrir rota no Google Maps
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
