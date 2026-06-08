import { useEffect, useMemo, useState } from 'react';
import { Car, Pencil, Power, Plus, Save } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { api } from '../services/api';
import type { Vehicle } from '../services/types';

type VehicleForm = {
  name: string;
  year: string;
  plate: string;
  mileage: string;
};

const EMPTY_FORM: VehicleForm = {
  name: '',
  year: '',
  plate: '',
  mileage: '0'
};

export default function Vehicles() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [form, setForm] = useState<VehicleForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadVehicles() {
    setLoading(true);
    setError(null);
    try {
      const response = await api<Vehicle[]>('/resources/vehicles');
      setVehicles(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel carregar os veiculos.');
      setVehicles([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadVehicles();
  }, []);

  const activeVehicles = useMemo(() => vehicles.filter((vehicle) => vehicle.active), [vehicles]);
  const inactiveVehicles = useMemo(() => vehicles.filter((vehicle) => !vehicle.active), [vehicles]);

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setError(null);
  }

  function startEdit(vehicle: Vehicle) {
    setEditingId(vehicle.id);
    setForm({
      name: vehicle.name,
      year: vehicle.year?.toString() ?? '',
      plate: vehicle.plate,
      mileage: String(vehicle.mileage ?? 0)
    });
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      name: form.name.trim(),
      year: form.year.trim() ? Number(form.year) : null,
      plate: form.plate.trim().toUpperCase(),
      mileage: Number(form.mileage || '0')
    };

    try {
      if (editingId) {
        await api<Vehicle>(`/resources/vehicles/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
      } else {
        await api<Vehicle>('/resources/vehicles', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }

      resetForm();
      await loadVehicles();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel salvar o veiculo.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleVehicle(id: string) {
    setError(null);
    try {
      await api<Vehicle>(`/resources/vehicles/${id}/toggle`, {
        method: 'POST'
      });
      await loadVehicles();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel alterar o status do veiculo.');
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <Car className="h-7 w-7 text-blue-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">Veiculos</h1>
            <p className="text-zinc-400">Cadastre nome do veiculo, ano, placa e quilometragem da frota.</p>
          </div>
        </div>
        <Button className="bg-blue-500 hover:bg-blue-600" onClick={resetForm}>
          <Plus className="mr-2 h-4 w-4" />
          Novo veiculo
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-6">
            <div className="text-2xl font-bold text-white">{vehicles.length}</div>
            <div className="text-xs text-zinc-400">Total cadastrados</div>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-6">
            <div className="text-2xl font-bold text-white">{activeVehicles.length}</div>
            <div className="text-xs text-zinc-400">Veiculos ativos</div>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-6">
            <div className="text-2xl font-bold text-white">{inactiveVehicles.length}</div>
            <div className="text-xs text-zinc-400">Veiculos inativos</div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-zinc-900/50 border-zinc-800">
        <CardHeader>
          <CardTitle className="text-white">{editingId ? 'Editar veiculo' : 'Cadastrar veiculo'}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 lg:grid-cols-4" onSubmit={handleSubmit}>
            <label className="space-y-2 lg:col-span-2">
              <span className="text-sm text-zinc-300">Nome do veiculo</span>
              <input
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-white outline-none focus:border-blue-500"
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="Ex.: Strada branca"
                required
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm text-zinc-300">Ano</span>
              <input
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-white outline-none focus:border-blue-500"
                value={form.year}
                onChange={(event) => setForm((current) => ({ ...current, year: event.target.value }))}
                placeholder="2024"
                inputMode="numeric"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm text-zinc-300">Placa</span>
              <input
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 uppercase text-white outline-none focus:border-blue-500"
                value={form.plate}
                onChange={(event) => setForm((current) => ({ ...current, plate: event.target.value.toUpperCase() }))}
                placeholder="ABC1D23"
                required
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm text-zinc-300">Quilometragem</span>
              <input
                className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-white outline-none focus:border-blue-500"
                value={form.mileage}
                onChange={(event) => setForm((current) => ({ ...current, mileage: event.target.value }))}
                placeholder="0"
                inputMode="numeric"
                required
              />
            </label>

            <div className="flex items-end gap-3 lg:col-span-4">
              <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={saving} type="submit">
                <Save className="mr-2 h-4 w-4" />
                {saving ? 'Salvando...' : editingId ? 'Salvar alteracoes' : 'Cadastrar veiculo'}
              </Button>
              {editingId ? (
                <Button className="border-zinc-700 text-zinc-200" disabled={saving} type="button" variant="outline" onClick={resetForm}>
                  Cancelar edicao
                </Button>
              ) : null}
            </div>
          </form>
          {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}
        </CardContent>
      </Card>

      {loading ? (
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-8 text-center text-sm text-zinc-500">Carregando veiculos...</CardContent>
        </Card>
      ) : vehicles.length === 0 ? (
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-8 text-center text-sm text-zinc-500">Nenhum veiculo cadastrado ainda.</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {vehicles.map((vehicle) => (
            <Card key={vehicle.id} className="bg-zinc-900/50 border-zinc-800 hover:border-zinc-700 transition-all">
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500">
                      <Car className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <CardTitle className="text-white text-lg">{vehicle.name}</CardTitle>
                      <div className="mt-1 text-sm text-zinc-400">{vehicle.plate}</div>
                    </div>
                  </div>
                  <Badge className={vehicle.active ? 'bg-green-600' : 'bg-zinc-700'}>
                    {vehicle.active ? 'Ativo' : 'Inativo'}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 text-sm text-zinc-300 md:grid-cols-2">
                  <div>
                    <span className="block text-xs uppercase tracking-wide text-zinc-500">Ano</span>
                    <strong>{vehicle.year ?? 'Nao informado'}</strong>
                  </div>
                  <div>
                    <span className="block text-xs uppercase tracking-wide text-zinc-500">Quilometragem</span>
                    <strong>{new Intl.NumberFormat('pt-BR').format(vehicle.mileage ?? 0)} km</strong>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button className="bg-zinc-800 hover:bg-zinc-700 text-white" type="button" onClick={() => startEdit(vehicle)}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Editar
                  </Button>
                  <Button className="border-zinc-700 text-zinc-200" type="button" variant="outline" onClick={() => toggleVehicle(vehicle.id)}>
                    <Power className="mr-2 h-4 w-4" />
                    {vehicle.active ? 'Desativar' : 'Ativar'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
