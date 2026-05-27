import { useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, AlertCircle, User, MapPin, Calendar, Clock, FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { api } from '../services/api';
import type { Appointment } from '../services/types';
import { formatDate, formatTime } from '../services/types';

const statusConfig = {
  complete: { label: 'Completo', color: 'bg-green-500' },
  partial: { label: 'Pendente', color: 'bg-yellow-500' }
};

export default function Validation() {
  const navigate = useNavigate();
  const [appointments, setAppointments] = useState<Appointment[]>([]);

  const load = () => api<Appointment[]>('/validations').then(setAppointments).catch(() => setAppointments([]));
  useEffect(() => { load(); }, []);

  const validations = useMemo(() => {
    return appointments.map((appointment) => {
      const checklist = [
        { item: 'Cliente confirmado', validated: Boolean(appointment.client) },
        { item: 'Técnico confirmado', validated: Boolean(appointment.technician) },
        { item: 'Hotel confirmado', validated: !appointment.needsHotel || Boolean(appointment.hotel) },
        { item: 'Transporte confirmado', validated: !appointment.needsTransport || Boolean(appointment.vehicle) },
        { item: 'OS criada', validated: Boolean(appointment.osNumber) },
        { item: 'Checklist cliente recebido', validated: Boolean(appointment.clientChecklist) },
        { item: 'Endereço informado', validated: Boolean(appointment.fullAddress) }
      ];
      const complete = checklist.every((item) => item.validated);
      return {
        id: appointment.id,
        client: appointment.client?.name ?? 'Cliente',
        technician: appointment.technician?.name ?? 'Sem técnico',
        city: appointment.city,
        date: formatDate(appointment.date),
        time: formatTime(appointment.startTime),
        checklist,
        status: complete ? 'complete' : 'partial',
        appointment
      };
    });
  }, [appointments]);

  async function completeValidation(id: string) {
    const item = appointments.find((appointment) => appointment.id === id);
    if (!item) return;
    await api('/validations', {
      method: 'POST',
      body: JSON.stringify({
        appointmentId: id,
        clientConfirmed: true,
        cityConfirmed: true,
        addressConfirmed: true,
        technicianConfirmed: Boolean(item.technicianId),
        dateConfirmed: true,
        timeConfirmed: true,
        terminalConfirmed: true,
        hotelConfirmed: !item.needsHotel || Boolean(item.hotel),
        transportConfirmed: !item.needsTransport || Boolean(item.vehicle),
        osCreated: Boolean(item.osNumber),
        clientChecklistReceived: Boolean(item.clientChecklist),
        validatorName: 'Validador'
      })
    });
    await load();
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CheckCircle className="h-7 w-7 text-blue-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">Validação Final</h1>
            <p className="text-zinc-400">Checklist de aprovação dos atendimentos do banco</p>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-6">
            <div className="text-2xl font-bold text-white">{validations.filter((item) => item.status === 'partial').length}</div>
            <div className="text-xs text-zinc-400">Aguardando Validação</div>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-6">
            <div className="text-2xl font-bold text-white">{validations.filter((item) => item.status === 'complete').length}</div>
            <div className="text-xs text-zinc-400">Com checklist completo</div>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-blue-400" />
              <div>
                <div className="text-2xl font-bold text-white">{validations.length}</div>
                <div className="text-xs text-zinc-400">Total em análise</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        {validations.length === 0 && (
          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardContent className="p-8 text-center text-sm text-zinc-500">
              Nenhum atendimento aguardando validação.
            </CardContent>
          </Card>
        )}

        {validations.map((validation) => {
          const validated = validation.checklist.filter((item) => item.validated).length;
          const total = validation.checklist.length;
          const progress = total > 0 ? (validated / total) * 100 : 0;
          const statusConf = statusConfig[validation.status as keyof typeof statusConfig];

          return (
            <Card key={validation.id} className="bg-zinc-900/50 border-zinc-800">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <CardTitle className="text-white text-lg">{validation.client}</CardTitle>
                      <Badge className={statusConf.color}>
                        {validation.status === 'complete' ? <CheckCircle className="h-3 w-3 mr-1" /> : <AlertCircle className="h-3 w-3 mr-1" />}
                        {statusConf.label}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-4 text-sm text-zinc-400">
                      <div className="flex items-center gap-1.5"><User className="h-3.5 w-3.5" /><span>{validation.technician}</span></div>
                      <div className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /><span>{validation.city}</span></div>
                      <div className="flex items-center gap-1.5"><Calendar className="h-3.5 w-3.5" /><span>{validation.date}</span></div>
                      <div className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /><span>{validation.time}</span></div>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-zinc-400">Progresso do Checklist</span>
                    <span className="text-sm font-medium text-white">{validated}/{total} itens</span>
                  </div>
                  <Progress value={progress} className="h-2" />
                </div>

                <div className="grid md:grid-cols-2 gap-3">
                  {validation.checklist.map((item) => (
                    <div key={item.item} className={`flex items-start gap-3 p-3 rounded-lg border ${item.validated ? 'bg-green-500/5 border-green-500/20' : 'bg-zinc-800/30 border-zinc-700'}`}>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 ${item.validated ? 'bg-green-500 border-green-500' : 'border-zinc-600'}`}>
                        {item.validated && <CheckCircle className="h-3 w-3 text-white" />}
                      </div>
                      <p className={`text-sm font-medium ${item.validated ? 'text-green-400' : 'text-white'}`}>{item.item}</p>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 pt-2 border-t border-zinc-800">
                  <Button className="flex-1 bg-blue-500 hover:bg-blue-600" onClick={() => completeValidation(validation.id)}>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Completar Validação
                  </Button>
                  <Button variant="outline" className="border-zinc-700" onClick={() => navigate(`/appointments/${validation.id}`)}>
                    Ver Detalhes
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
