import { type PointerEvent, useEffect, useRef, useState } from 'react';
import { Save, Sparkles } from 'lucide-react';
import { api } from '../services/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';

type WeeklyAiReport = {
  ok: boolean;
  generated: boolean;
  generatedAt?: string;
  periodStart: string;
  periodEnd: string;
  sourceCount: number;
  report: string;
};

type TechnicianProfile = {
  id: string;
  name: string;
  signatureDataUrl: string | null;
};

export default function TechnicianWeeklyReport() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [profile, setProfile] = useState<TechnicianProfile | null>(null);
  const [signatureDataUrl, setSignatureDataUrl] = useState('');
  const [savingSignature, setSavingSignature] = useState(false);
  const [signatureMessage, setSignatureMessage] = useState('');
  const [weeklyReport, setWeeklyReport] = useState<WeeklyAiReport | null>(null);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [reportError, setReportError] = useState('');

  useEffect(() => {
    api<TechnicianProfile>('/technician/profile')
      .then((result) => {
        setProfile(result);
        setSignatureDataUrl(result.signatureDataUrl || '');
      })
      .catch((error) => setSignatureMessage(error instanceof Error ? error.message : 'Nao foi possivel carregar o perfil.'));
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (!signatureDataUrl) return;
    const image = new Image();
    image.onload = () => context.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.src = signatureDataUrl;
  }, [signatureDataUrl]);

  function pointerPosition(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function startDrawing(event: PointerEvent<HTMLCanvasElement>) {
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    const point = pointerPosition(event);
    drawingRef.current = true;
    context.beginPath();
    context.moveTo(point.x, point.y);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function draw(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    const point = pointerPosition(event);
    context.lineWidth = 5;
    context.lineCap = 'round';
    context.strokeStyle = '#111827';
    context.lineTo(point.x, point.y);
    context.stroke();
  }

  function stopDrawing() {
    if (!drawingRef.current || !canvasRef.current) return;
    drawingRef.current = false;
    setSignatureDataUrl(canvasRef.current.toDataURL('image/png'));
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (canvas && context) {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    setSignatureDataUrl('');
    setSignatureMessage('');
  }

  async function saveSignature() {
    if (!signatureDataUrl) {
      setSignatureMessage('Desenhe sua assinatura antes de salvar.');
      return;
    }
    setSavingSignature(true);
    setSignatureMessage('');
    try {
      await api('/technician/profile/signature', {
        method: 'PUT',
        body: JSON.stringify({ signatureDataUrl })
      });
      setSignatureMessage('Assinatura salva. Ela sera usada automaticamente nos proximos relatos.');
    } catch (error) {
      setSignatureMessage(error instanceof Error ? error.message : 'Nao foi possivel salvar a assinatura.');
    } finally {
      setSavingSignature(false);
    }
  }

  async function generateWeeklyReport() {
    setGeneratingReport(true);
    setReportError('');
    try {
      const result = await api<WeeklyAiReport>('/technician/weekly-report', { method: 'POST' });
      setWeeklyReport(result);
      if (!result.ok) setReportError(result.report);
    } catch (error) {
      setReportError(error instanceof Error ? error.message : 'Nao foi possivel gerar o relatorio semanal.');
    } finally {
      setGeneratingReport(false);
    }
  }

  return (
    <div className="min-h-screen bg-background px-3 py-4 sm:px-6 sm:py-6">
      <div className="mx-auto w-full max-w-3xl space-y-5">
        <div>
          <h1 className="text-2xl font-bold">Relatorio semanal</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Resumo de todos os atendimentos finalizados por {profile?.name || 'voce'} na semana atual.
          </p>
        </div>

        <Card className="rounded-2xl border-blue-500/20 bg-blue-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-blue-400" /> Relatorio com IA
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button className="w-full" onClick={generateWeeklyReport} disabled={generatingReport}>
              <Sparkles className="mr-2 h-4 w-4" />
              {generatingReport ? 'Analisando relatos...' : weeklyReport ? 'Atualizar relatorio' : 'Gerar relatorio da semana'}
            </Button>
            {reportError && <p className="text-sm text-red-400">{reportError}</p>}
            {weeklyReport && (
              <div className="rounded-xl border bg-background/80 p-4">
                <p className="mb-3 text-xs text-muted-foreground">{weeklyReport.sourceCount} atendimento(s) analisado(s)</p>
                <div className="whitespace-pre-wrap text-sm leading-6">{weeklyReport.report}</div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle>Minha assinatura</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Assine uma vez. O sistema carregara esta assinatura automaticamente em seus proximos relatos tecnicos.
            </p>
            <canvas
              ref={canvasRef}
              width={640}
              height={220}
              className="h-44 w-full touch-none rounded-xl border bg-white"
              onPointerDown={startDrawing}
              onPointerMove={draw}
              onPointerUp={stopDrawing}
              onPointerCancel={stopDrawing}
              onPointerLeave={stopDrawing}
            />
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={clearSignature}>Limpar</Button>
              <Button onClick={saveSignature} disabled={savingSignature}>
                <Save className="mr-2 h-4 w-4" /> {savingSignature ? 'Salvando...' : 'Salvar assinatura'}
              </Button>
            </div>
            {signatureMessage && <p className="text-sm text-muted-foreground">{signatureMessage}</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
