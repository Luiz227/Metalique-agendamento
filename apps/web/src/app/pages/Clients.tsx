import { useEffect, useState } from 'react';
import { Building2, Mail, MapPin, Phone, Plus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { api } from '../services/api';
import type { ApiUser } from '../services/api';
import type { Client } from '../services/types';

const emptyForm = {
  name: '',
  cnpj: '',
  ie: '',
  city: '',
  state: '',
  district: '',
  zipCode: '',
  address: '',
  contact: '',
  phone: '',
  email: '',
  latitude: '',
  longitude: '',
  salesOwnerId: ''
};

export default function Clients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [salesUsers, setSalesUsers] = useState<ApiUser[]>([]);
  const [form, setForm] = useState(emptyForm);

  async function load() {
    const [clientRows, userRows] = await Promise.all([
      api<Client[]>('/clients'),
      api<Array<ApiUser & { active: boolean }>>('/users').catch(() => [])
    ]);
    setClients(clientRows);
    setSalesUsers(userRows.filter((user) => user.role === 'SALES'));
  }

  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await api('/clients', {
      method: 'POST',
      body: JSON.stringify({
        ...form,
        state: form.state.toUpperCase(),
        latitude: form.latitude ? Number(form.latitude) : null,
        longitude: form.longitude ? Number(form.longitude) : null,
        salesOwnerId: form.salesOwnerId || null
      })
    });
    setForm(emptyForm);
    await load();
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Building2 className="h-7 w-7 text-blue-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Clientes</h1>
          <p className="text-zinc-400">Cadastro usado nos atendimentos e na agenda</p>
        </div>
      </div>

      <Card className="bg-zinc-900/50 border-zinc-800">
        <CardHeader>
          <CardTitle className="text-white">Novo Cliente</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid md:grid-cols-4 gap-3">
            <Input required placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
            <Input placeholder="CNPJ" value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
            <Input placeholder="IE" value={form.ie} onChange={(e) => setForm({ ...form, ie: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
            <Input required placeholder="Cidade" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
            <Input placeholder="Estado (UF)" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value.toUpperCase() })} className="bg-zinc-800/50 border-zinc-700" />
            <Input placeholder="Bairro" value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
            <Input placeholder="CEP" value={form.zipCode} onChange={(e) => setForm({ ...form, zipCode: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
            <Input required placeholder="Endereco" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
            <Input placeholder="Contato" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
            <Input placeholder="Telefone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
            <Input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
            <Input type="number" step="any" placeholder="Latitude para o mapa" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
            <Input type="number" step="any" placeholder="Longitude para o mapa" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
            <select value={form.salesOwnerId} onChange={(e) => setForm({ ...form, salesOwnerId: e.target.value })} className="bg-zinc-800/50 border border-zinc-700 rounded-md px-3 text-zinc-200">
              <option value="">Vendedor responsavel</option>
              {salesUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
            <Button className="bg-blue-500 hover:bg-blue-600 md:col-span-4">
              <Plus className="h-4 w-4 mr-2" />
              Adicionar Cliente
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        {clients.map((client) => (
          <Card key={client.id} className="bg-zinc-900/50 border-zinc-800">
            <CardContent className="p-5 space-y-3">
              <h3 className="font-semibold text-white">{client.name}</h3>
              <p className="text-sm text-zinc-400 flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                {client.address} · {client.city}
              </p>
              {(client.district || client.state || client.zipCode) && (
                <p className="text-xs text-zinc-500">{[client.district, client.state, client.zipCode].filter(Boolean).join(' · ')}</p>
              )}
              {(client.cnpj || client.ie) && (
                <p className="text-xs text-zinc-500">
                  {[client.cnpj ? `CNPJ: ${client.cnpj}` : '', client.ie ? `IE: ${client.ie}` : ''].filter(Boolean).join(' · ')}
                </p>
              )}
              {client.phone && (
                <p className="text-sm text-zinc-400 flex items-center gap-2">
                  <Phone className="h-4 w-4" />
                  {client.phone}
                </p>
              )}
              {client.email && (
                <p className="text-sm text-zinc-400 flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  {client.email}
                </p>
              )}
              <p className="text-xs text-zinc-500">Vendedor: {client.salesOwner?.name ?? 'Nao definido'}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
