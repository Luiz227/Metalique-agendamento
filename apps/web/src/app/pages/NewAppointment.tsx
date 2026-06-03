import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Progress } from '../components/ui/progress';
import { ApiError, api } from '../services/api';
import type { Client, Technician, Vehicle } from '../services/types';

const steps = [
  'Cliente',
  'Serviço',
  'Técnico',
  'Logística',
  'Confirmação'
];
const DRAFT_KEY = 'agenda-metalique:new-appointment-draft:v1';
const COMPANY_BASE_ADDRESS = 'R. Reinaldo Raulino dos Santos, 107 - Éden, Sorocaba - SP, 18086-796';

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

function localDateTimeIso(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString();
}

function localDateNoonIso(date: string) {
  return new Date(`${date}T12:00:00`).toISOString();
}

function addHoursToTime(date: string, time: string, hours: number) {
  const value = new Date(`${date}T${time}:00`);
  value.setHours(value.getHours() + hours);
  return value.toISOString();
}

export default function NewAppointment() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [travelEstimate, setTravelEstimate] = useState<{ distanceText: string; durationText: string } | null>(null);
  const [travelLoading, setTravelLoading] = useState(false);
  const [checklist, setChecklist] = useState({
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
  const [formData, setFormData] = useState({
    companyName: '',
    cnpj: '',
    contactName: '',
    phone: '',
    email: '',
    city: '',
    address: '',
    serviceType: '',
    serviceDescription: '',
    machineName: '',
    machineModel: '',
    machineSerial: '',
    serviceDate: '',
    serviceTime: '',
    daysOut: '1',
    technicianId: '',
    hasHotel: false,
    vehicleId: '',
    transportMode: 'CAR',
    flightAirport: '',
    flightDepartureAt: '',
    flightReturnAt: '',
    hotelName: '',
    hotelAddress: '',
    hotelCheckIn: '',
    hotelCheckOut: '',
    hotelDailyRate: '',
    hotelNotes: '',
    attentionPoints: ''
  });

  const progress = ((currentStep + 1) / steps.length) * 100;
  const selectedTechnician = technicians.find((item) => item.id === formData.technicianId);
  const requiredChecklistDone = Object.values(checklist).every(Boolean);

  useEffect(() => {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw) as {
        currentStep?: number;
        formData?: typeof formData;
        checklist?: typeof checklist;
      };
      if (typeof draft.currentStep === 'number') setCurrentStep(Math.min(Math.max(draft.currentStep, 0), steps.length - 1));
      if (draft.formData) setFormData((prev) => ({ ...prev, ...draft.formData }));
      if (draft.checklist) setChecklist((prev) => ({ ...prev, ...draft.checklist }));
      toast.success('Rascunho carregado automaticamente.');
    } catch {
      localStorage.removeItem(DRAFT_KEY);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        currentStep,
        formData,
        checklist,
        savedAt: new Date().toISOString()
      })
    );
  }, [currentStep, formData, checklist]);

  useEffect(() => {
    Promise.all([
      api<Technician[]>('/technicians'),
      api<Vehicle[]>('/resources/vehicles')
    ])
      .then(([techs, vehs]) => {
        setTechnicians(techs);
        setVehicles(vehs);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Erro ao carregar dados'));
  }, []);

  useEffect(() => {
    const destination = buildMapsDestination(formData.address, formData.city);
    if (currentStep !== 0 || destination.length < 6) {
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
    }, 500);

    return () => clearTimeout(timer);
  }, [currentStep, formData.address, formData.city]);

  const canContinue = useMemo(() => {
    if (currentStep === 0) return Boolean(formData.companyName && formData.cnpj && formData.address);
    if (currentStep === 1) return Boolean(formData.serviceType && formData.serviceDescription && formData.serviceDate && formData.serviceTime && Number(formData.daysOut) > 0);
    if (currentStep === 2) return Boolean(formData.technicianId);
    if (currentStep === 3) return Boolean(formData.transportMode && formData.attentionPoints);
    if (currentStep === 4) return requiredChecklistDone && !saving;
    return true;
  }, [currentStep, formData, requiredChecklistDone, saving]);

  async function createClient() {
    return api<Client>('/clients', {
      method: 'POST',
      body: JSON.stringify({
        name: formData.companyName,
        contact: formData.contactName || null,
        email: formData.email || null,
        city: formData.city || 'A definir',
        address: formData.address,
        notes: formData.cnpj ? `CNPJ: ${formData.cnpj}` : null
      })
    });
  }

  async function createAppointment(isDraft = false) {
    const client = await createClient();
    return api('/appointments', {
      method: 'POST',
      body: JSON.stringify({
        clientId: client.id,
        technicianId: formData.technicianId || null,
        city: formData.city || 'A definir',
        fullAddress: formData.address,
        serviceType: formData.serviceType || 'Pendente definição',
        problemDescription: formData.serviceDescription || 'Pendente descrição do serviço',
        date: formData.serviceDate ? localDateNoonIso(formData.serviceDate) : localDateNoonIso(new Date().toISOString().slice(0, 10)),
        startTime: formData.serviceDate && formData.serviceTime
          ? localDateTimeIso(formData.serviceDate, formData.serviceTime)
          : new Date().toISOString(),
        endTime: formData.serviceDate && formData.serviceTime
          ? addHoursToTime(formData.serviceDate, formData.serviceTime, 2)
          : new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        daysOut: Number(formData.daysOut || '1'),
        status: 'WAITING',
        machineName: formData.machineName || null,
        machineModel: formData.machineModel || null,
        machineSerial: formData.machineSerial || null,
        hasHotel: formData.hasHotel,
        needsHotel: formData.hasHotel,
        needsTransport: formData.transportMode !== 'NONE',
        vehicleId: formData.transportMode === 'CAR' && formData.vehicleId !== 'NO_TRANSPORT' ? formData.vehicleId : null,
        transportMode: formData.transportMode,
        flightAirport: formData.transportMode === 'AIR' ? formData.flightAirport || null : null,
        flightDepartureAt: formData.transportMode === 'AIR' && formData.flightDepartureAt ? new Date(formData.flightDepartureAt).toISOString() : null,
        flightReturnAt: formData.transportMode === 'AIR' && formData.flightReturnAt ? new Date(formData.flightReturnAt).toISOString() : null,
        hotelName: formData.hotelName || null,
        hotelAddress: formData.hotelAddress || null,
        hotelCheckIn: formData.hotelCheckIn ? new Date(formData.hotelCheckIn).toISOString() : null,
        hotelCheckOut: formData.hotelCheckOut ? new Date(formData.hotelCheckOut).toISOString() : null,
        hotelDailyRate: formData.hotelDailyRate || null,
        hotelNotes: formData.hotelNotes || null,
        osNumber: '',
        clientChecklist: formData.cnpj ? `CNPJ: ${formData.cnpj}` : '',
        notes: formData.attentionPoints,
        schedulingChecklist: isDraft
          ? {
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
              clientChecklistChecked: false,
              notes: 'Rascunho criado na etapa inicial'
            }
          : checklist
      })
    });
  }

  async function handleNext() {
    if (currentStep === 0) {
      setSaving(true);
      setError('');
      try {
        const appointment = await createAppointment(true) as { id: string };
        localStorage.removeItem(DRAFT_KEY);
        toast.success('Agendamento criado em preenchimento.');
        navigate(`/appointments/${appointment.id}`);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Erro ao criar agendamento');
      } finally {
        setSaving(false);
      }
      return;
    }

    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
      return;
    }

    setSaving(true);
    setError('');
    try {
      if (!requiredChecklistDone) {
        setError('Preencha todo o checklist antes de finalizar o agendamento.');
        return;
      }
      await createAppointment();
      localStorage.removeItem(DRAFT_KEY);
      toast.success('Agendamento realizado com sucesso.');
      navigate('/schedule');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao criar atendimento');
    } finally {
      setSaving(false);
    }
  }

  function handleBack() {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
      return;
    }
    navigate('/schedule');
  }

  function saveDraftManually() {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        currentStep,
        formData,
        checklist,
        savedAt: new Date().toISOString()
      })
    );
    toast.success('Rascunho salvo com sucesso.');
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <Button variant="ghost" onClick={() => navigate('/schedule')} className="mb-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Voltar
        </Button>
        <Button variant="outline" onClick={saveDraftManually} className="mb-4 ml-2 border-zinc-700">
          Salvar rascunho
        </Button>
        <h1 className="text-2xl font-bold text-white mb-2">Novo Agendamento</h1>
        <p className="text-zinc-400">Preencha os dados da empresa, atendimento e técnico responsável.</p>
      </div>

      <Card className="bg-zinc-900/50 border-zinc-800 mb-6">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-white">Etapa {currentStep + 1} de {steps.length}</span>
            <span className="text-sm text-zinc-400">{Math.round(progress)}% completo</span>
          </div>
          <Progress value={progress} className="mb-4" />
          <div className="flex items-center justify-between">
            {steps.map((step, idx) => (
              <div key={step} className={`flex items-center gap-2 ${idx <= currentStep ? 'text-blue-400' : 'text-zinc-500'}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium ${idx < currentStep ? 'bg-blue-500 text-white' : idx === currentStep ? 'bg-blue-500/20 border-2 border-blue-500 text-blue-400' : 'bg-zinc-800 text-zinc-500'}`}>
                  {idx < currentStep ? <Check className="h-4 w-4" /> : idx + 1}
                </div>
                <span className="text-xs hidden lg:block">{step}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-zinc-900/50 border-zinc-800">
        <CardHeader>
          <CardTitle className="text-white">{steps[currentStep]}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {currentStep === 0 && (
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label>Nome da empresa</Label>
                <Input required value={formData.companyName} onChange={(e) => setFormData({ ...formData, companyName: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
              </div>
              <div>
                <Label>CNPJ</Label>
                <Input required placeholder="00.000.000/0000-00" value={formData.cnpj} onChange={(e) => setFormData({ ...formData, cnpj: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
              </div>
              <div>
                <Label>Contato</Label>
                <Input required value={formData.contactName} onChange={(e) => setFormData({ ...formData, contactName: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
              </div>
              <div>
                <Label>Email</Label>
                <Input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
              </div>
              <div>
                <Label>Cidade</Label>
                <Input required placeholder="Ex: Indaiatuba - SP" value={formData.city} onChange={(e) => setFormData({ ...formData, city: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
              </div>
              <div>
                <Label>Endereço completo</Label>
                <Input required value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
                <p className="text-[11px] text-zinc-500 mt-1">Base fixa de sa?da: {COMPANY_BASE_ADDRESS}</p>
                {travelLoading && <p className="text-xs text-zinc-400 mt-1">Calculando tempo de viagem...</p>}
                {travelEstimate && (
                  <p className="text-xs text-emerald-400 mt-1">
                    Tempo estimado: {travelEstimate.durationText} ? Dist?ncia: {travelEstimate.distanceText}
                  </p>
                )}
              </div>
            </div>
          )}

          {currentStep === 1 && (
            <div className="space-y-4">
              <div>
                <Label>Tipo de serviço</Label>
                <Select value={formData.serviceType} onValueChange={(value) => setFormData({ ...formData, serviceType: value })}>
                  <SelectTrigger className="bg-zinc-800/50 border-zinc-700"><SelectValue placeholder="Selecione o tipo" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Instalação">Instalação</SelectItem>
                    <SelectItem value="Manutenção">Manutenção</SelectItem>
                    <SelectItem value="Reparo">Reparo</SelectItem>
                    <SelectItem value="Inspeção">Inspeção</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label>Data</Label>
                  <Input type="date" value={formData.serviceDate} onChange={(e) => setFormData({ ...formData, serviceDate: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
                </div>
                <div>
                  <Label>Horário inicial</Label>
                  <Input type="time" value={formData.serviceTime} onChange={(e) => setFormData({ ...formData, serviceTime: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
                </div>
                <div>
                  <Label>Quantidade de dias da viagem</Label>
                  <Input type="number" min="1" value={formData.daysOut} onChange={(e) => setFormData({ ...formData, daysOut: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
                </div>
              </div>
              <div>
                <Label>Serviço (obrigatório)</Label>
                <Textarea placeholder="Descreva o motivo e o serviço a executar." value={formData.serviceDescription} onChange={(e) => setFormData({ ...formData, serviceDescription: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
              </div>
              <div className="grid md:grid-cols-3 gap-3">
                <div>
                  <Label>Nome da maquina</Label>
                  <Input placeholder="Ex.: Mesa / corte de metais" value={formData.machineName} onChange={(e) => setFormData({ ...formData, machineName: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
                </div>
                <div>
                  <Label>Modelo da maquina</Label>
                  <Input placeholder="Ex.: ML5030 tubo laser" value={formData.machineModel} onChange={(e) => setFormData({ ...formData, machineModel: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
                </div>
                <div>
                  <Label>Numero de serie</Label>
                  <Input placeholder="Ex.: 1250/1709" value={formData.machineSerial} onChange={(e) => setFormData({ ...formData, machineSerial: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
                </div>
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-4">
              <div>
                <Label>Técnico</Label>
                <Select value={formData.technicianId} onValueChange={(value) => setFormData({ ...formData, technicianId: value })}>
                  <SelectTrigger className="bg-zinc-800/50 border-zinc-700"><SelectValue placeholder="Selecione o técnico" /></SelectTrigger>
                  <SelectContent>
                    {technicians.map((technician) => (
                      <SelectItem key={technician.id} value={technician.id}>{technician.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedTechnician && (
                <div className="flex items-center gap-2 text-sm text-zinc-300">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: selectedTechnician.color ?? '#3b82f6' }} />
                  Esse técnico será identificado por essa cor no mapa.
                </div>
              )}
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-blue-400 mt-0.5" />
                  <p className="text-xs text-zinc-400">As sugestões de proximidade serão calculadas automaticamente após salvar o agendamento.</p>
                </div>
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div className="space-y-4">
              <div>
                <Label>Tipo de viagem</Label>
                <Select value={formData.transportMode} onValueChange={(value) => setFormData({ ...formData, transportMode: value })}>
                  <SelectTrigger className="bg-zinc-800/50 border-zinc-700"><SelectValue placeholder="Selecione o tipo de viagem" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Nao precisa de viagem</SelectItem>
                    <SelectItem value="CAR">Viagem de carro</SelectItem>
                    <SelectItem value="AIR">Viagem aerea</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {formData.transportMode === 'CAR' && (
              <div>
                <Label>Veiculo</Label>
                <Select value={formData.vehicleId} onValueChange={(value) => setFormData({ ...formData, vehicleId: value })}>
                  <SelectTrigger className="bg-zinc-800/50 border-zinc-700"><SelectValue placeholder="Selecione o veiculo" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NO_TRANSPORT">Nao informado</SelectItem>
                    {vehicles.map((vehicle) => (
                      <SelectItem key={vehicle.id} value={vehicle.id}>{vehicle.name} - {vehicle.plate}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              )}
              {formData.transportMode === 'AIR' && (
              <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-800/20 p-3">
                <Label>Dados do voo</Label>
                <Input placeholder="Aeroporto" value={formData.flightAirport} onChange={(e) => setFormData({ ...formData, flightAirport: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
                <div className="grid md:grid-cols-2 gap-3">
                  <div>
                    <Label>Ida - data e hora</Label>
                    <Input type="datetime-local" value={formData.flightDepartureAt} onChange={(e) => setFormData({ ...formData, flightDepartureAt: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
                  </div>
                  <div>
                    <Label>Volta - data e hora</Label>
                    <Input type="datetime-local" value={formData.flightReturnAt} onChange={(e) => setFormData({ ...formData, flightReturnAt: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
                  </div>
                </div>
              </div>
              )}
              <div className="space-y-3">
                <Label>Hospedagem</Label>
                <Select value={formData.hasHotel ? 'YES' : 'NO'} onValueChange={(value) => setFormData({ ...formData, hasHotel: value === 'YES' })}>
                  <SelectTrigger className="bg-zinc-800/50 border-zinc-700"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NO">Nao tem hospedagem</SelectItem>
                    <SelectItem value="YES">Tem hospedagem</SelectItem>
                  </SelectContent>
                </Select>
                {formData.hasHotel && (
                <>
                <Input placeholder="Nome do hotel" value={formData.hotelName} onChange={(e) => setFormData({ ...formData, hotelName: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
                <Input placeholder="Endereco do hotel" value={formData.hotelAddress} onChange={(e) => setFormData({ ...formData, hotelAddress: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
                <Input type="number" step="0.01" min="0" placeholder="Valor da hospedagem" value={formData.hotelDailyRate} onChange={(e) => setFormData({ ...formData, hotelDailyRate: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
                <div className="grid md:grid-cols-2 gap-3">
                  <div>
                    <Label>Check-in</Label>
                    <Input type="datetime-local" value={formData.hotelCheckIn} onChange={(e) => setFormData({ ...formData, hotelCheckIn: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
                  </div>
                  <div>
                    <Label>Check-out</Label>
                    <Input type="datetime-local" value={formData.hotelCheckOut} onChange={(e) => setFormData({ ...formData, hotelCheckOut: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
                  </div>
                </div>
                <Textarea placeholder="Informacoes sobre reserva, horario, observacoes ou regras do hotel." value={formData.hotelNotes} onChange={(e) => setFormData({ ...formData, hotelNotes: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
                </>
                )}
              </div>
              <div>
                <Label>Ponto de atencao (obrigatorio)</Label>
                <Textarea placeholder="Ex.: levar cabo X, validar checklist Y." value={formData.attentionPoints} onChange={(e) => setFormData({ ...formData, attentionPoints: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
              </div>
            </div>
          )}

          {currentStep === 4 && (
            <div className="space-y-4">
              <div className="bg-zinc-800/30 rounded-lg p-4 space-y-3">
                <h4 className="font-medium text-white">Resumo do agendamento</h4>
                <div className="grid md:grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div className="text-zinc-400">Empresa:</div><div className="text-white">{formData.companyName || '-'}</div>
                  <div className="text-zinc-400">Contato:</div><div className="text-white">{formData.contactName || '-'}</div>
                  <div className="text-zinc-400">Email:</div><div className="text-white">{formData.email || '-'}</div>
                  <div className="text-zinc-400">Endereço:</div><div className="text-white">{formData.address || '-'}</div>
                  <div className="text-zinc-400">Cidade:</div><div className="text-white">{formData.city || '-'}</div>
                  <div className="text-zinc-400">Serviço:</div><div className="text-white">{formData.serviceType || '-'}</div>
                  <div className="text-zinc-400">Descrição do serviço:</div><div className="text-white">{formData.serviceDescription || '-'}</div>
                  <div className="text-zinc-400">Ponto de atenção:</div><div className="text-white">{formData.attentionPoints || '-'}</div>
                  <div className="text-zinc-400">Dias de viagem:</div><div className="text-white">{formData.daysOut || '-'}</div>
                  <div className="text-zinc-400">Data/Hora:</div><div className="text-white">{formData.serviceDate || '-'} às {formData.serviceTime || '-'}</div>
                  <div className="text-zinc-400">Técnico:</div><div className="text-white">{selectedTechnician?.name ?? '-'}</div>
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                {[
                  ['clientConfirmed', 'Cliente confirmado'],
                  ['contactConfirmed', 'Contato confirmado'],
                  ['addressConfirmed', 'Endereço confirmado'],
                  ['serviceTypeConfirmed', 'Tipo de serviço confirmado'],
                  ['technicianSelected', 'Técnico selecionado'],
                  ['technicianAvailability', 'Disponibilidade do técnico conferida'],
                  ['dateTimeConfirmed', 'Data e horário confirmados'],
                  ['hotelNeedChecked', 'Necessidade de hotel conferida'],
                  ['transportNeedChecked', 'Necessidade de transporte conferida'],
                  ['osChecked', 'OS conferida ou marcada como pendente'],
                  ['clientChecklistChecked', 'Checklist do cliente conferido']
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-800/30 p-3 text-sm text-zinc-200">
                    <input type="checkbox" checked={checklist[key as keyof typeof checklist]} onChange={(event) => setChecklist({ ...checklist, [key]: event.target.checked })} className="h-4 w-4 accent-blue-500" />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-6 border-t border-zinc-800">
                <Button variant="outline" onClick={handleBack} className="border-zinc-700">
              <ArrowLeft className="h-4 w-4 mr-2" />
              {currentStep === 0 ? 'Cancelar' : 'Voltar'}
            </Button>
            <Button onClick={handleNext} className="bg-blue-500 hover:bg-blue-600" disabled={!canContinue}>
              {currentStep === 0 ? (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  {saving ? 'Criando...' : 'Criar Agendamento'}
                </>
              ) : currentStep === steps.length - 1 ? (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  {saving ? 'Criando...' : 'Criar Agendamento'}
                </>
              ) : (
                <>
                  Próximo
                  <ArrowRight className="h-4 w-4 ml-2" />
                </>
              )}
            </Button>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
