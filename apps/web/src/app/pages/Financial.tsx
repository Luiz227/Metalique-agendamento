import { useEffect, useMemo, useState } from 'react';
import { DollarSign, TrendingDown, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { api } from '../services/api';
import { money } from '../services/types';

type ExpenseRow = {
  id: string;
  hotelPlanned: number;
  transportPlanned: number;
  fuelPlanned: number;
  tollPlanned: number;
  mealsPlanned: number;
  otherPlanned: number;
  hotelReal: number;
  transportReal: number;
  fuelReal: number;
  tollReal: number;
  mealsReal: number;
  otherReal: number;
  appointment?: {
    city: string;
    client?: { name: string };
    technician?: { name: string } | null;
  };
};

function plannedTotal(expense: ExpenseRow) {
  return Number(expense.hotelPlanned) + Number(expense.transportPlanned) + Number(expense.fuelPlanned) + Number(expense.tollPlanned) + Number(expense.mealsPlanned) + Number(expense.otherPlanned);
}

function realTotal(expense: ExpenseRow) {
  return Number(expense.hotelReal) + Number(expense.transportReal) + Number(expense.fuelReal) + Number(expense.tollReal) + Number(expense.mealsReal) + Number(expense.otherReal);
}

export default function Financial() {
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);

  useEffect(() => {
    api<ExpenseRow[]>('/finance/expenses').then(setExpenses).catch(() => setExpenses([]));
  }, []);

  const totals = useMemo(() => {
    const planned = expenses.reduce((sum, item) => sum + plannedTotal(item), 0);
    const real = expenses.reduce((sum, item) => sum + realTotal(item), 0);
    return { planned, real, difference: planned - real };
  }, [expenses]);

  const economyRate = totals.planned > 0 ? ((totals.difference / totals.planned) * 100).toFixed(1) : '0.0';

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <DollarSign className="h-7 w-7 text-green-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Painel Financeiro</h1>
          <p className="text-zinc-400">Acompanhamento de custos registrados no banco</p>
        </div>
      </div>

      <div className="grid md:grid-cols-4 gap-4">
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-6">
            <div className="text-2xl font-bold text-white">{money(totals.planned)}</div>
            <div className="text-xs text-zinc-400">Gastos Previstos</div>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-6">
            <div className="text-2xl font-bold text-white">{money(totals.real)}</div>
            <div className="text-xs text-zinc-400">Gastos Reais</div>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-6">
            <div className="text-2xl font-bold text-green-400">{money(totals.difference)}</div>
            <div className="text-xs text-zinc-400">Diferença</div>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-6">
            <div className="text-2xl font-bold text-purple-400">{economyRate}%</div>
            <div className="text-xs text-zinc-400">Taxa de Diferença</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="bg-zinc-900 border-zinc-800">
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="appointments">Por Atendimento</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-blue-400" />
                Resumo Financeiro
              </CardTitle>
            </CardHeader>
            <CardContent>
              {expenses.length === 0 ? (
                <div className="p-8 text-center text-sm text-zinc-500">Nenhuma despesa cadastrada ainda.</div>
              ) : (
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="rounded-lg bg-zinc-800/30 p-4">
                    <p className="text-sm text-zinc-400">Total previsto</p>
                    <p className="mt-1 text-2xl font-bold text-white">{money(totals.planned)}</p>
                  </div>
                  <div className="rounded-lg bg-zinc-800/30 p-4">
                    <p className="text-sm text-zinc-400">Total real</p>
                    <p className="mt-1 text-2xl font-bold text-white">{money(totals.real)}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="appointments">
          <Card className="bg-zinc-900/50 border-zinc-800">
            <CardHeader>
              <CardTitle className="text-white flex items-center gap-2">
                <TrendingDown className="h-5 w-5 text-green-400" />
                Custos por Atendimento
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {expenses.length === 0 && <div className="p-8 text-center text-sm text-zinc-500">Nenhuma despesa cadastrada ainda.</div>}
              {expenses.map((expense) => (
                <div key={expense.id} className="rounded-lg border border-zinc-800 bg-zinc-800/30 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-medium text-white">{expense.appointment?.client?.name ?? 'Atendimento'}</p>
                      <p className="text-sm text-zinc-400">{expense.appointment?.city ?? 'Cidade não informada'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-zinc-400">Previsto / Real</p>
                      <p className="font-bold text-white">{money(plannedTotal(expense))} / {money(realTotal(expense))}</p>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
