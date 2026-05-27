import { useEffect, useMemo, useState } from 'react';
import { Sparkles, MapPin, Clock, DollarSign, TrendingUp, Users, Check, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Separator } from '../components/ui/separator';
import { ApiError, api } from '../services/api';
import type { Suggestion } from '../services/types';
import { formatDate, formatTime, money } from '../services/types';

const priorityConfig = {
  high: { label: 'Alta Prioridade', color: 'bg-red-500' },
  medium: { label: 'Média Prioridade', color: 'bg-yellow-500' },
  low: { label: 'Baixa Prioridade', color: 'bg-blue-500' }
};

export default function Suggestions() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [error, setError] = useState('');

  const loadSuggestions = () => {
    api<Suggestion[]>('/suggestions')
      .then(setSuggestions)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Erro ao carregar sugestões'));
  };

  useEffect(loadSuggestions, []);

  async function updateSuggestion(id: string, status: 'ACCEPTED' | 'IGNORED') {
    await api(`/suggestions/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    loadSuggestions();
  }

  const totalSavings = useMemo(() => suggestions.reduce((acc, item) => acc + Number(item.potentialSavings), 0), [suggestions]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Sparkles className="h-7 w-7 text-purple-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">Sugestões Inteligentes</h1>
            <p className="text-zinc-400">O sistema mostra aqui apenas sugestões criadas a partir dos atendimentos do banco.</p>
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
                <div className="text-3xl font-bold text-white">{suggestions.length}</div>
                <div className="text-sm text-zinc-300">Sugestões Disponíveis</div>
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
                <div className="text-3xl font-bold text-white">{suggestions.filter((item) => item.score >= 80).length}</div>
                <div className="text-sm text-zinc-300">Alta Prioridade</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        {suggestions.length === 0 && (
          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardContent className="p-8 text-center text-sm text-zinc-300">
              Nenhuma sugestão encontrada. Cadastre atendimentos próximos para o sistema calcular oportunidades.
            </CardContent>
          </Card>
        )}

        {suggestions.map((suggestion) => {
          const priority = suggestion.score >= 80 ? 'high' : suggestion.score >= 50 ? 'medium' : 'low';
          const priorityConf = priorityConfig[priority];
          const appointments = [suggestion.originAppointment, suggestion.nearbyAppointment];

          return (
            <Card key={suggestion.id} className="bg-zinc-900/50 border-zinc-800 hover:border-purple-500/30 transition-all">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <Sparkles className="h-5 w-5 text-purple-400" />
                      <CardTitle className="text-white text-lg">
                        Agrupar {suggestion.originAppointment.city} e {suggestion.nearbyAppointment.city}
                      </CardTitle>
                    </div>
                    <p className="text-sm text-zinc-400">{suggestion.reason}</p>
                  </div>
                  <Badge className={priorityConf.color}>{priorityConf.label}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3">
                  {appointments.map((appointment) => (
                    <div key={appointment.id} className="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/30 border border-zinc-700">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Users className="h-4 w-4 text-zinc-400 flex-shrink-0" />
                          <span className="text-sm font-medium text-white truncate">{appointment.technician?.name ?? 'Sem técnico'}</span>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
                          <span>{appointment.client?.name ?? 'Cliente'}</span>
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {appointment.city}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDate(appointment.date)} às {formatTime(appointment.startTime)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <Separator className="bg-zinc-800" />

                <div className="grid md:grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-zinc-400">Distância</span>
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
                  <Button className="flex-1 bg-purple-500 hover:bg-purple-600" onClick={() => updateSuggestion(suggestion.id, 'ACCEPTED')}>
                    <Check className="h-4 w-4 mr-2" />
                    Aplicar Sugestão
                  </Button>
                  <Button variant="outline" className="border-zinc-700 text-red-400 hover:bg-red-500/10" onClick={() => updateSuggestion(suggestion.id, 'IGNORED')}>
                    <X className="h-4 w-4" />
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
