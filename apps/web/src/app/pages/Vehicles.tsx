import { useEffect, useState } from 'react';
import { Car, User } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { api } from '../services/api';
import type { Vehicle } from '../services/types';

export default function Vehicles() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);

  useEffect(() => {
    api<Vehicle[]>('/resources/vehicles').then(setVehicles).catch(() => setVehicles([]));
  }, []);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Car className="h-7 w-7 text-blue-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">Veículos</h1>
            <p className="text-zinc-400">Gestão da frota operacional</p>
          </div>
        </div>
        <Button className="bg-blue-500 hover:bg-blue-600">Adicionar Veículo</Button>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-6">
            <div className="text-2xl font-bold text-white">{vehicles.length}</div>
            <div className="text-xs text-zinc-400">Total de Veículos</div>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-6">
            <div className="text-2xl font-bold text-white">{vehicles.filter((vehicle) => vehicle.driverName).length}</div>
            <div className="text-xs text-zinc-400">Com motorista informado</div>
          </CardContent>
        </Card>
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-6">
            <div className="text-2xl font-bold text-white">{vehicles.filter((vehicle) => !vehicle.driverName).length}</div>
            <div className="text-xs text-zinc-400">Sem motorista informado</div>
          </CardContent>
        </Card>
      </div>

      {vehicles.length === 0 && (
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-8 text-center text-sm text-zinc-500">Nenhum veículo cadastrado ainda.</CardContent>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {vehicles.map((vehicle) => (
          <Card key={vehicle.id} className="bg-zinc-900/50 border-zinc-800 hover:border-zinc-700 transition-all">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
                    <Car className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-white text-lg">{vehicle.name}</CardTitle>
                    <span className="text-sm text-zinc-400">{vehicle.plate}</span>
                  </div>
                </div>
                <Badge className="bg-green-500">Cadastrado</Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <User className="h-4 w-4" />
                {vehicle.driverName ?? 'Motorista não informado'}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
