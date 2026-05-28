import { useEffect, useMemo, useState } from 'react';
import { BarChart3, CalendarClock, CheckCircle2, Image as ImageIcon, Sparkles, Users, Wrench } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { api } from '../services/api';
import { formatDate, money } from '../services/types';

type DashboardReports = Record<string, any>;
type SummaryReports = Record<string, any>;

type TechnicalAttachment = {
  id: string;
  type: string;
  originalName: string;
  fileName: string;
  mimeType: string;
  size: number;
  path: string;
  uploadedAt: string;
};

type TechnicalReportItem = {
  id: string;
  summary: string;
  diagnosis?: string | null;
  solution?: string | null;
  pendingItems?: string | null;
  createdAt: string;
  finishedAt?: string | null;
  technician: { id: string; name: string; color: string };
  appointment: {
    id: string;
    city: string;
    date: string;
    serviceType: string;
    fullAddress: string;
    client: { id: string; name: string; phone?: string | null; email?: string | null };
    attachments: TechnicalAttachment[];
  };
};

function mediaUrl(path: string) {
  const apiUrl = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '/api';
  const origin = apiUrl.replace(/\/api\/?$/, '');
  return `${origin}${path}`;
}

export default function Reports() {
  const [reports, setReports] = useState<SummaryReports>({});
  const [dashboard, setDashboard] = useState<DashboardReports>({});
  const [technicalReports, setTechnicalReports] = useState<TechnicalReportItem[]>([]);

  useEffect(() => {
    Promise.all([
      api<SummaryReports>('/reports'),
      api<DashboardReports>('/dashboard'),
      api<TechnicalReportItem[]>('/reports/technical')
    ])
      .then(([rep, dash, tech]) => {
        setReports(rep);
        setDashboard(dash);
        setTechnicalReports(tech);
      })
      .catch(() => undefined);
  }, []);

  const cards = [
    ['Atendimentos por técnico', dashboard.charts?.technicianUsage ?? [], Users],
    ['Pendências por status', dashboard.charts?.status ?? [], CheckCircle2],
    ['Cidades mais atendidas', reports.byCity ?? [], BarChart3],
    ['Sugestões', [{ label: 'Aceitas', total: reports.suggestionsAccepted ?? 0 }, { label: 'Ignoradas', total: reports.suggestionsIgnored ?? 0 }], Sparkles]
  ] as const;

  const totalImages = useMemo(
    () =>
      technicalReports.reduce((sum, item) => {
        return sum + item.appointment.attachments.filter((att) => att.mimeType.startsWith('image/')).length;
      }, 0),
    [technicalReports]
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <BarChart3 className="h-7 w-7 text-[#c8142f]" />
        <div>
          <h1 className="text-2xl font-bold text-white">Relatórios</h1>
          <p className="text-zinc-400">Indicadores e relatos técnicos dos atendimentos</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {cards.map(([title, rows, Icon]) => (
          <Card key={title} className="bg-zinc-900/50 border-zinc-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <Icon className="h-5 w-5 text-[#c8142f]" />
                {title}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(rows as any[]).map((row, idx) => (
                <div key={idx} className="flex justify-between border-b border-zinc-800 pb-2 text-sm">
                  <span className="text-zinc-300">{row.label ?? row.city ?? row.technician ?? 'Item'}</span>
                  <span className="text-white font-medium">{row.total ?? row.value ?? money(row.real ?? row.planned)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-zinc-900/50 border-zinc-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Wrench className="h-5 w-5 text-[#c8142f]" />
            Relatórios Técnicos
          </CardTitle>
          <p className="text-sm text-zinc-400">
            {technicalReports.length} relato(s) técnico(s) enviados e {totalImages} imagem(ns) anexada(s)
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {technicalReports.length === 0 && (
            <p className="text-sm text-zinc-500">Nenhum relatório técnico enviado até o momento.</p>
          )}

          {technicalReports.map((item) => {
            const images = item.appointment.attachments.filter((att) => att.mimeType.startsWith('image/'));
            return (
              <div key={item.id} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-white font-semibold">{item.appointment.client.name}</p>
                    <p className="text-xs text-zinc-400">
                      {item.appointment.city} - {formatDate(item.appointment.date)} - {item.appointment.serviceType}
                    </p>
                  </div>
                  <span className="text-xs text-zinc-300 rounded-md border border-zinc-700 px-2 py-1">
                    Técnico: {item.technician.name}
                  </span>
                </div>

                <div className="grid md:grid-cols-2 gap-3 text-sm">
                  <div className="rounded-md border border-zinc-800 p-3">
                    <p className="text-zinc-400 mb-1">Resumo</p>
                    <p className="text-zinc-100">{item.summary}</p>
                  </div>
                  <div className="rounded-md border border-zinc-800 p-3">
                    <p className="text-zinc-400 mb-1">Diagnóstico</p>
                    <p className="text-zinc-100">{item.diagnosis || 'Não informado'}</p>
                  </div>
                  <div className="rounded-md border border-zinc-800 p-3">
                    <p className="text-zinc-400 mb-1">Solução aplicada</p>
                    <p className="text-zinc-100">{item.solution || 'Não informado'}</p>
                  </div>
                  <div className="rounded-md border border-zinc-800 p-3">
                    <p className="text-zinc-400 mb-1">Pendências</p>
                    <p className="text-zinc-100">{item.pendingItems || 'Sem pendências'}</p>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-xs text-zinc-400">
                  <span className="inline-flex items-center gap-1"><CalendarClock className="h-4 w-4" /> Enviado em {formatDate(item.createdAt)}</span>
                  <span className="inline-flex items-center gap-1"><ImageIcon className="h-4 w-4" /> {images.length} imagem(ns)</span>
                </div>

                {images.length > 0 && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {images.map((img) => (
                      <a key={img.id} href={mediaUrl(img.path)} target="_blank" rel="noreferrer" className="block rounded-md overflow-hidden border border-zinc-800">
                        <img src={mediaUrl(img.path)} alt={img.originalName} className="h-28 w-full object-cover" loading="lazy" />
                      </a>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
