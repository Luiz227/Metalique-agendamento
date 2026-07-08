import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import Logo from '../components/Logo';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { ApiError, api, getToken, getUser, setSession, type ApiUser } from '../services/api';
import { useForcedDarkTheme } from '../hooks/useForcedDarkTheme';

function destinationByRole(role: ApiUser['role']) {
  if (role === 'TECHNICIAN') return '/technician';
  if (role === 'LOGISTICS' || role === 'VALIDATOR' || role === 'SALES') return '/appointments/manage';
  return '/dashboard';
}

export default function ChangePassword() {
  useForcedDarkTheme();
  const navigate = useNavigate();
  const user = getUser();
  const token = getToken();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  if (!token || !user) return <Navigate to="/login" replace />;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('A nova senha deve ter pelo menos 8 caracteres.');
      return;
    }
    if (password !== confirmation) {
      setError('As senhas digitadas nao conferem.');
      return;
    }
    setSaving(true);
    try {
      const response = await api<{ ok: true; user: ApiUser }>('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ newPassword: password })
      });
      setSession(token, response.user);
      navigate(destinationByRole(response.user.role), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel alterar a senha.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 p-5">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/80 p-7 shadow-2xl backdrop-blur-xl">
        <div className="mb-7 flex justify-center"><Logo size="md" /></div>
        <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-red-600/15 text-red-400">
          <KeyRound className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold text-white">Crie sua nova senha</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Ola, {user.name}. Por seguranca, altere a senha provisoria antes de acessar o sistema.
        </p>

        <form className="mt-7 space-y-5" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="new-password" className="text-zinc-300">Nova senha</Label>
            <div className="relative">
              <Input id="new-password" type={showPassword ? 'text' : 'password'} minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} className="border-zinc-700 bg-zinc-800/50 pr-11 text-white" required />
              <button type="button" onClick={() => setShowPassword((current) => !current)} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-zinc-400 hover:text-white" aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
            <p className="text-xs text-zinc-500">Use pelo menos 8 caracteres.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password" className="text-zinc-300">Confirmar nova senha</Label>
            <div className="relative">
              <Input id="confirm-password" type={showConfirmation ? 'text' : 'password'} minLength={8} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="border-zinc-700 bg-zinc-800/50 pr-11 text-white" required />
              <button type="button" onClick={() => setShowConfirmation((current) => !current)} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-zinc-400 hover:text-white" aria-label={showConfirmation ? 'Ocultar senha' : 'Mostrar senha'}>
                {showConfirmation ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>
          {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
          <Button className="w-full bg-red-600 hover:bg-red-700" size="lg" disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar nova senha e continuar'}
          </Button>
        </form>
      </div>
    </div>
  );
}
