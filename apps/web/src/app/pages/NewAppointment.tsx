import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { ApiError } from '../services/api';
import { createAppointmentDraft } from '../services/appointmentDraft';

export default function NewAppointment() {
  const navigate = useNavigate();
  const startedRef = useRef(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      try {
        const draft = await createAppointmentDraft();
        toast.success('Rascunho criado. Vamos abrir o formulario completo.');
        navigate(`/appointments/${draft.id}?editing=1&source=create`, { replace: true });
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Nao foi possivel abrir a criacao completa do agendamento.');
      }
    })();
  }, [navigate]);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Button variant="ghost" onClick={() => navigate('/appointments/manage')} className="mb-4">
        <ArrowLeft className="h-4 w-4 mr-2" />
        Voltar
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Preparando o formulario completo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!error && (
            <div className="flex items-center gap-3 text-sm text-zinc-300">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              <span>Criando o rascunho inicial para abrir a tela oficial do agendamento...</span>
            </div>
          )}

          {error && (
            <div className="space-y-3">
              <p className="text-sm text-red-500">{error}</p>
              <div className="flex gap-2">
                <Button onClick={() => window.location.reload()}>Tentar novamente</Button>
                <Button variant="outline" onClick={() => navigate('/appointments/manage')}>
                  Voltar para a central
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
