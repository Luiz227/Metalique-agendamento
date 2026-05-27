import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Checkbox } from '../components/ui/checkbox';
import { CalendarCheck2, MapPin, Users } from 'lucide-react';
import Logo from '../components/Logo';
import { ApiError, api, setSession, type ApiUser } from '../services/api';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await api<{ token: string; user: ApiUser }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      setSession(response.token, response.user);
      navigate(response.user.role === 'TECHNICIAN' ? '/technician' : '/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Falha no login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 flex">
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-red-700/20 to-zinc-950" />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, rgb(255 255 255 / 0.05) 1px, transparent 0)',
            backgroundSize: '40px 40px'
          }}
        />

        <div className="relative z-10 flex flex-col justify-center px-16 text-white">
          <div className="mb-8">
            <Logo size="lg" />
          </div>

          <h1 className="text-5xl font-bold mb-6 leading-tight">
            Sistema de Agendamento
            <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-400 to-red-600">
              da Metalique
            </span>
          </h1>

          <p className="text-xl text-zinc-300 mb-12">
            Organize atendimentos, viagens e tecnicos com controle operacional completo.
          </p>

          <div className="space-y-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center flex-shrink-0">
                <MapPin className="h-5 w-5 text-red-400" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">Monitoramento em Tempo Real</h3>
                <p className="text-zinc-400 text-sm">Visualize tecnicos, rotas e atendimentos no mapa operacional.</p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center flex-shrink-0">
                <CalendarCheck2 className="h-5 w-5 text-red-400" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">Agenda Inteligente</h3>
                <p className="text-zinc-400 text-sm">Acompanhe reagendamentos, prioridades e viagens da semana.</p>
              </div>
            </div>

            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center flex-shrink-0">
                <Users className="h-5 w-5 text-red-400" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">Gestao Completa</h3>
                <p className="text-zinc-400 text-sm">Tecnicos, veiculos, hoteis e custos em uma unica plataforma.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center mb-8 justify-center">
            <Logo size="md" />
          </div>

          <div className="bg-zinc-900/50 backdrop-blur-xl border border-zinc-800 rounded-2xl p-8 shadow-2xl">
            <div className="mb-8">
              <h2 className="text-3xl font-bold text-white mb-2">Bem-vindo de volta</h2>
              <p className="text-zinc-400">Entre com suas credenciais para acessar o sistema</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-zinc-300">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-zinc-800/50 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-red-500"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-zinc-300">Senha</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-zinc-800/50 border-zinc-700 text-white placeholder:text-zinc-500 focus:border-red-500"
                  required
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="remember"
                    checked={rememberMe}
                    onCheckedChange={(checked) => setRememberMe(checked as boolean)}
                  />
                  <Label htmlFor="remember" className="text-sm text-zinc-400 cursor-pointer">
                    Lembrar-me
                  </Label>
                </div>
                <a href="#" className="text-sm text-red-400 hover:text-red-300">
                  Esqueceu a senha?
                </a>
              </div>

              <Button
                type="submit"
                className="w-full bg-red-600 hover:bg-red-700 text-white font-medium"
                size="lg"
                disabled={loading}
              >
                {loading ? 'Entrando...' : 'Entrar'}
              </Button>
              {error && <p className="text-sm text-red-400 text-center">{error}</p>}
            </form>

            <div className="mt-6 text-center text-sm text-zinc-500">
              Sistema de Agendamento da Metalique
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
