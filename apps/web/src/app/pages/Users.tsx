import { useEffect, useState } from 'react';
import { Edit, Shield, Trash2, UserPlus, Users as UsersIcon, X } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { ApiError, api, getUser, type ApiUser } from '../services/api';

type UserWithRelations = ApiUser & {
  active: boolean;
  technician?: { id: string; name: string; color?: string; active: boolean } | null;
  ownedClients?: Array<{ id: string; name: string; city: string }>;
};

type UserForm = {
  name: string;
  email: string;
  password: string;
  role: ApiUser['role'];
  active: boolean;
  technicianColor: string;
};

const roleLabels: Record<ApiUser['role'], string> = {
  ADMIN: 'Administrador',
  LOGISTICS: 'Agenda/Logística',
  TECHNICIAN: 'Técnico',
  VALIDATOR: 'Validador final',
  SALES: 'Vendas'
};

const defaultColors = ['#2563eb', '#16a34a', '#dc2626', '#ca8a04', '#9333ea', '#0891b2', '#ea580c', '#db2777'];

const emptyForm: UserForm = {
  name: '',
  email: '',
  password: '',
  role: 'SALES',
  active: true,
  technicianColor: defaultColors[0]
};

export default function Users() {
  const loggedUser = getUser();
  const [users, setUsers] = useState<UserWithRelations[]>([]);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<UserForm>(emptyForm);

  async function load() {
    setUsers(await api<UserWithRelations[]>('/users'));
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof ApiError ? err.message : 'Erro ao carregar usuários'));
  }, []);

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setError('');
  }

  function startEdit(user: UserWithRelations) {
    setEditingId(user.id);
    setForm({
      name: user.name,
      email: user.email,
      password: '',
      role: user.role,
      active: user.active,
      technicianColor: user.technician?.color ?? defaultColors[0]
    });
    setError('');
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');

    try {
      if (editingId) {
        const body = {
          name: form.name,
          email: form.email,
          role: form.role,
          active: form.active,
          technicianColor: form.technicianColor,
          ...(form.password ? { password: form.password } : {})
        };
        await api(`/users/${editingId}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await api('/users', { method: 'POST', body: JSON.stringify(form) });
      }

      startCreate();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao salvar usuário');
    }
  }

  async function removeUser(user: UserWithRelations) {
    if (user.id === loggedUser?.id) {
      setError('Não é possível excluir o próprio usuário logado.');
      return;
    }

    const confirmed = window.confirm(`Excluir o usuário ${user.name}? Esta ação remove o acesso ao sistema.`);
    if (!confirmed) return;

    setError('');
    try {
      await api(`/users/${user.id}`, { method: 'DELETE' });
      if (editingId === user.id) startCreate();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao excluir usuário');
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <UsersIcon className="h-7 w-7 text-blue-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Usuários e Permissões</h1>
          <p className="text-zinc-400">Administração de acessos para agenda, técnicos, vendas e validação.</p>
        </div>
      </div>

      <Card className="bg-zinc-900/50 border-zinc-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-blue-400" />
              {editingId ? 'Editar Usuário' : 'Novo Usuário'}
            </span>
            {editingId && (
              <Button type="button" variant="ghost" size="sm" onClick={startCreate} className="text-zinc-300">
                <X className="h-4 w-4 mr-2" />
                Cancelar edição
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid md:grid-cols-4 gap-3">
            <Input required placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
            <Input required type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
            <Input required={!editingId} placeholder={editingId ? 'Nova senha, se quiser alterar' : 'Senha inicial'} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="bg-zinc-800/50 border-zinc-700" />
            <Select value={form.role} onValueChange={(role) => setForm({ ...form, role: role as ApiUser['role'] })}>
              <SelectTrigger className="bg-zinc-800/50 border-zinc-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(roleLabels).map(([role, label]) => (
                  <SelectItem key={role} value={role}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <label className="md:col-span-4 flex items-center gap-2 text-sm text-zinc-200">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="accent-blue-500" />
              Usuário ativo
            </label>

            {form.role === 'TECHNICIAN' && (
              <div className="md:col-span-4">
                <p className="text-sm font-medium text-zinc-200 mb-2">Cor do técnico no mapa</p>
                <div className="flex flex-wrap items-center gap-3">
                  <Input
                    type="color"
                    value={form.technicianColor}
                    onChange={(e) => setForm({ ...form, technicianColor: e.target.value })}
                    className="h-10 w-16 p-1 bg-zinc-800/50 border-zinc-700"
                  />
                  {defaultColors.map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={`Selecionar cor ${color}`}
                      className={`h-8 w-8 rounded-full border-2 ${form.technicianColor === color ? 'border-white' : 'border-zinc-700'}`}
                      style={{ backgroundColor: color }}
                      onClick={() => setForm({ ...form, technicianColor: color })}
                    />
                  ))}
                </div>
              </div>
            )}

            <Button className="md:col-span-4 bg-blue-500 hover:bg-blue-600">
              {editingId ? 'Salvar Alterações' : 'Criar Usuário'}
            </Button>
          </form>
          {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        {users.map((user) => (
          <Card key={user.id} className="bg-zinc-900/50 border-zinc-800">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-white">{user.name}</h3>
                  <p className="text-sm text-zinc-400">{user.email}</p>
                </div>
                <Badge className={user.active ? 'bg-green-500' : 'bg-zinc-600'}>{user.active ? 'Ativo' : 'Inativo'}</Badge>
              </div>

              <div className="flex items-center gap-2 text-sm text-zinc-300">
                <Shield className="h-4 w-4 text-blue-400" />
                {roleLabels[user.role]}
                {user.technician?.color && <span className="h-3 w-3 rounded-full" style={{ backgroundColor: user.technician.color }} />}
              </div>

              {user.role === 'SALES' && (
                <p className="text-xs text-zinc-500">Clientes vinculados: {user.ownedClients?.length ?? 0}</p>
              )}

              <div className="flex gap-2 pt-2 border-t border-zinc-800">
                <Button type="button" variant="outline" size="sm" className="border-zinc-700" onClick={() => startEdit(user)}>
                  <Edit className="h-4 w-4 mr-2" />
                  Editar
                </Button>
                <Button type="button" variant="outline" size="sm" className="border-red-500/40 text-red-300 hover:text-red-200" onClick={() => removeUser(user)}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Excluir
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
