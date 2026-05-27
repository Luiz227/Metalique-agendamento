import { useEffect, useMemo, useState } from 'react';
import { Bell, Info } from 'lucide-react';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { api } from '../services/api';

type NotificationItem = {
  id: string;
  title: string;
  message: string;
  readAt?: string | null;
  createdAt: string;
};

export default function Notifications() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  useEffect(() => {
    api<NotificationItem[]>('/notifications').then(setNotifications).catch(() => setNotifications([]));
  }, []);

  const unread = useMemo(() => notifications.filter((notification) => !notification.readAt), [notifications]);

  const renderList = (items: NotificationItem[]) => (
    <div className="space-y-3">
      {items.length === 0 && (
        <Card className="bg-zinc-900/50 border-zinc-800">
          <CardContent className="p-8 text-center text-sm text-zinc-500">Nenhuma notificação encontrada.</CardContent>
        </Card>
      )}
      {items.map((notification) => (
        <Card key={notification.id} className={`bg-zinc-900/50 border-zinc-800 hover:border-zinc-700 transition-all ${!notification.readAt ? 'border-l-4 border-l-blue-500' : ''}`}>
          <CardContent className="p-4">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center flex-shrink-0">
                <Info className="h-5 w-5 text-blue-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h3 className={`font-medium ${!notification.readAt ? 'text-white' : 'text-zinc-300'}`}>{notification.title}</h3>
                  {!notification.readAt && <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1.5" />}
                </div>
                <p className="text-sm text-zinc-400 mb-2">{notification.message}</p>
                <span className="text-xs text-zinc-500">{new Date(notification.createdAt).toLocaleString('pt-BR')}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bell className="h-7 w-7 text-blue-400" />
          <div>
            <h1 className="text-2xl font-bold text-white">Notificações</h1>
            <p className="text-zinc-400">{unread.length > 0 ? `${unread.length} notificações não lidas` : 'Nenhuma notificação não lida'}</p>
          </div>
        </div>
        {unread.length > 0 && <Badge className="bg-blue-500">{unread.length} novas</Badge>}
      </div>

      <Tabs defaultValue="all" className="space-y-4">
        <TabsList className="bg-zinc-900 border-zinc-800">
          <TabsTrigger value="all">Todas</TabsTrigger>
          <TabsTrigger value="unread">Não Lidas</TabsTrigger>
        </TabsList>
        <TabsContent value="all">{renderList(notifications)}</TabsContent>
        <TabsContent value="unread">{renderList(unread)}</TabsContent>
      </Tabs>
    </div>
  );
}
