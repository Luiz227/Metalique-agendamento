import { useEffect, useMemo, useState } from 'react';
import { Sparkles, MapPin, Clock, DollarSign, TrendingUp, Users, Check, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { ApiError, api } from '../services/api';
import type { Appointment, Suggestion } from '../services/types';
import { formatDate, formatTime, money } from '../services/types';

const priorityConfig = {
  high: { label: 'Alta Prioridade', color: 'bg-red-500' },
  medium: { label: 'Media Prioridade', color: 'bg-yellow-500' },
  low: { label: 'Baixa Prioridade', color: 'bg-blue-500' }
};

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const radius = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * radius * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function isSameServiceDay(a: Appointment, b: Appointment) {
  const dateA = new Date(a.date);
  const dateB = new Date(b.date);
  return dateA.getFullYear() === dateB.getFullYear() && dateA.getMonth() === dateB.getMonth() && dateA.getDate() === dateB.getDate();
}

function buildSuggestionReason(a: Appointment, b: Appointment) {
  const sameDay = isSameServiceDay(a, b);
  const techA = a.technician?.id ?? a.technician?.name ?? '';
  const techB = b.technician?.id ?? b.technician?.name ?? '';
  const sameTechnician = Boolean(techA && techB && techA === techB);

  if (sameDay && !sameTechnician) {
    return 'Atendimentos proximos no mesmo dia: avaliar dividir o mesmo carro ou concentrar a rota com um tecnico.';
  }

  if (!sameDay && !sameTechnician) {
    return 'Atendimentos proximos em dias diferentes: avaliar reagendar ou enviar um tecnico para atender os dois clientes.';
  }

  if (!sameDay && sameTechnician) {
    return 'Mesmo tecnico com clientes proximos em dias diferentes: avaliar juntar as visitas na mesma viagem.';
  }

  return 'Atendimentos proximos: avaliar a melhor sequencia para reduzir deslocamento.';
}

function buildFallbackSuggestions(appointments: Appointment[]) {
  const suggestions: Suggestion[] = [];

  for (let i = 0; i < appointments.length; i += 1) {
    for (let j = i + 1; j < appointments.length; j += 1) {
      const a = appointments[i];
      const b = appointments[j];
      const pointA = {
        lat: a.latitude ?? a.client?.latitude ?? null,
        lng: a.longitude ?? a.client?.longitude ?? null
      };
      const pointB = {
        lat: b.latitude ?? b.client?.latitude ?? null,
        lng: b.longitude ?? b.client?.longitude ?? null
      };

      if (pointA.lat == null || pointA.lng == null || pointB.lat == null || pointB.lng == null) continue;

      const distanceKm = haversineKm(
        { lat: Number(pointA.lat), lng: Number(pointA.lng) },
        { lat: Number(pointB.lat), lng: Number(pointB.lng) }
      );

      if (!Number.isFinite(distanceKm) || distanceKm > 60) continue;

      const durationMinutes = Math.max(5, Math.round((distanceKm / 50) * 60));
      const score = Math.max(45, Math.min(100, Math.round(100 - distanceKm * 2)));
      const [originAppointment, nearbyAppointment] = [a, b].sort((left, right) => left.id.localeCompare(right.id));

      suggestions.push({
        id: `map-${originAppointment.id}-${nearbyAppointment.id}`,
        originAppointment,
        nearbyAppointment,
        distanceKm,
        durationMinutes,
        score,
        potentialSavings: Math.round(score * 10),
        reason: buildSuggestionReason(originAppointment, nearbyAppointment),
        status: 'OPEN'
      });
    }
  }

  return suggestions.sort((a, b) => a.distanceKm - b.distanceKm);
}

export default function Suggestions() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [error, setError] = useState('');

  const loadSuggestions = () => {
    Promise.all([api<Suggestion[]>('/suggestions'), api<Appointment[]>('/appointments')])
      .then(([loadedSuggestions, loadedAppointments]) => {
        setSuggestions(loadedSuggestions);
        setAppointments(loadedAppointments.filter((appointment) => appointment.status !== 'CRITICAL'));
        setError('');
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Erro ao carregar sugestoes'));
  };

  useEffect(loadSuggestions, []);

  async function updateSuggestion(id: string, status: 'ACCEPTED' | 'IGNORED') {
    await api(`/suggestions/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    loadSuggestions();
  }

  const mergedSuggestions = useMemo(() => {
    const fallbackSuggestions = buildFallbackSuggestions(appointments);
    const persistedKeys = new Set(
      suggestions.map((suggestion) =>
        [suggestion.originAppointment.id, suggestion.nearbyAppointment.id].sort().join(':')
      )
    );

    const extraSuggestions = fallbackSuggestions.filter((suggestion) => {
      const key = [suggestion.originAppointment.id, suggestion.nearbyAppointment.id].sort().join(':');
      return !persistedKeys.has(key);
    });

    return [...suggestions, ...extraSuggestions].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.distanceKm - b.distanceKm;
    });
  }, [appointments, suggestions]);

  const totalSavings = useMemo(
    () => mergedSuggestions.reduce((acc, item) => acc + Number(item.potentialSavings), 0),
    [mergedSuggestions]
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Sparkles className="h-7 w-7 text-purple-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">Sugestoes Inteligentes</h1>
            <p className="text-zinc-400">A tela mostra as sugestoes salvas na API e tambem as oportunidades detectadas no mapa.</p>
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="grid md:grid-cols-3 gap-4">
        <Card className="bg-zinc-900/70 border-purple-500/30">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center">
                <Sparkles className="h-6 w-6 text-purple-400" />
              </div>
              <div>
                <div className="text-3xl font-bold text-white">{mergedSuggestions.length}</div>
                <div className="text-sm text-zinc-300">Sugestoes Disponiveis</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900/70 border-green-500/30">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center">
                <DollarSign className="h-6 w-6 text-green-400" />
              </div>
              <div>
                <div className="text-3xl font-bold text-white">{money(totalSavings)}</div>
                <div className="text-sm text-zinc-300">Economia Potencial</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900/70 border-cyan-500/30">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-cyan-500/20 flex items-center justify-center">
                <TrendingUp className="h-6 w-6 text-cyan-400" />
              </div>
              <div>
                <div className="text-3xl font-bold text-white">{mergedSuggestions.filter((item) => item.score >= 80).length}</div>
                <div className="text-sm text-zinc-300">Alta Prioridade</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        {mergedSuggestions.length === 0 && (
          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardContent className="p-8 text-center text-sm text-zinc-300">
              Nenhuma sugestao encontrada. Cadastre atendimentos proximos para o sistema calcular oportunidades.
            </CardContent>
          </Card>
        )}

        {mergedSuggestions.map((suggestion) => {
          const priority = suggestion.score >= 80 ? 'high' : suggestion.score >= 50 ? 'medium' : 'low';
          const priorityConf = priorityConfig[priority];
          const suggestionAppointments = [suggestion.originAppointment, suggestion.nearbyAppointment];
          const isSavedSuggestion = !suggestion.id.startsWith('map-');

          return (
            <Card key={suggestion.id} className="bg-zinc-900/50 border-zinc-800 hover:border-purple-500/30 transition-all">
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                      <Sparkles className="h-5 w-5 text-purple-400" />
                      <CardTitle className="text-white text-lg">
                        Agrupar {suggestion.originAppointment.city} e {suggestion.nearbyAppointment.city}
                      </CardTitle>
                      <Badge className={isSavedSuggestion ? 'bg-purple-500' : 'bg-amber-500 text-black'}>
                        {isSavedSuggestion ? 'API' : 'Mapa'}
                      </Badge>
                    </div>
                    <p className="text-sm text-zinc-400">{suggestion.reason}</p>
                  </div>
                  <Badge className={priorityConf.color}>{priorityConf.label}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3">
                  {suggestionAppointments.map((appointment) => (
                    <div key={appointment.id} className="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/30 border border-zinc-700">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Users className="h-4 w-4 text-zinc-400 flex-shrink-0" />
                          <span className="text-sm font-medium text-white truncate">{appointment.technician?.name ?? 'Sem tecnico'}</span>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
                          <span>{appointment.client?.name ?? 'Cliente'}</span>
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {appointment.city}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDate(appointment.date)} as {formatTime(appointment.startTime)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <Separator className="bg-zinc-800" />

                <div className="grid md:grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-zinc-400">Distancia</span>
                    <p className="text-white font-medium">{suggestion.distanceKm.toFixed(1)} km</p>
                  </div>
                  <div>
                    <span className="text-zinc-400">Tempo estimado</span>
                    <p className="text-white font-medium">{suggestion.durationMinutes} min</p>
                  </div>
                  <div>
                    <span className="text-zinc-400">Economia</span>
                    <p className="text-purple-400 font-bold">{money(suggestion.potentialSavings)}</p>
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  {isSavedSuggestion ? (
                    <>
                      <Button className="flex-1 bg-purple-500 hover:bg-purple-600" onClick={() => updateSuggestion(suggestion.id, 'ACCEPTED')}>
                        <Check className="h-4 w-4 mr-2" />
                        Aplicar Sugestao
                      </Button>
                      <Button variant="outline" className="border-zinc-700 text-red-400 hover:bg-red-500/10" onClick={() => updateSuggestion(suggestion.id, 'IGNORED')}>
                        <X className="h-4 w-4" />
                      </Button>
                    </>
                  ) : (
                    <div className="text-xs text-zinc-400">
                      Esta sugestao aparece no mapa e agora esta visivel aqui tambem, mesmo antes de ser persistida pela API.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
