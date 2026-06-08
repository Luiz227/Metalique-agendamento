import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import type { ReactElement } from 'react';
import { Toaster } from './components/ui/sonner';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import MapView from './pages/MapView';
import Schedule from './pages/Schedule';
import NewAppointment from './pages/NewAppointment';
import AppointmentsManager from './pages/AppointmentsManager';
import AppointmentDetails from './pages/AppointmentDetails';
import Financial from './pages/Financial';
import Validation from './pages/Validation';
import TechnicianMobile from './pages/TechnicianMobile';
import TechnicianCalendar from './pages/TechnicianCalendar';
import Notifications from './pages/Notifications';
import Technicians from './pages/Technicians';
import Vehicles from './pages/Vehicles';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Users from './pages/Users';
import Kanban from './pages/Kanban';
import Layout from './components/Layout';
import { getToken, getUser, type ApiUser } from './services/api';

function RequireAuth() {
  return getToken() ? <Layout /> : <Navigate to="/login" replace />;
}

function homeByRole(role?: ApiUser['role']) {
  if (role === 'TECHNICIAN') return '/technician';
  if (role === 'LOGISTICS') return '/appointments/manage';
  if (role === 'VALIDATOR') return '/validation';
  if (role === 'SALES') return '/appointments/manage';
  return '/dashboard';
}

function RequireRole({ roles, children }: { roles: ApiUser['role'][]; children: ReactElement }) {
  const user = getUser();
  if (!user || !roles.includes(user.role)) {
    return <Navigate to={homeByRole(user?.role)} replace />;
  }
  return children;
}

export default function App() {
  const user = getUser();

  return (
    <BrowserRouter>
      <Toaster />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<RequireAuth />}>
          <Route index element={<Navigate to={homeByRole(user?.role)} replace />} />
          <Route path="dashboard" element={<RequireRole roles={['ADMIN']}><Dashboard /></RequireRole>} />
          <Route path="map" element={<RequireRole roles={['ADMIN', 'LOGISTICS', 'SALES']}><MapView /></RequireRole>} />
          <Route path="schedule" element={<RequireRole roles={['ADMIN', 'LOGISTICS', 'SALES']}><Schedule /></RequireRole>} />
          <Route path="appointments/manage" element={<RequireRole roles={['ADMIN', 'LOGISTICS', 'SALES']}><AppointmentsManager /></RequireRole>} />
          <Route path="kanban" element={<RequireRole roles={['ADMIN']}><Kanban /></RequireRole>} />
          <Route path="appointments/new" element={<RequireRole roles={['ADMIN', 'LOGISTICS', 'SALES']}><NewAppointment /></RequireRole>} />
          <Route path="appointments/:id" element={<RequireRole roles={['ADMIN', 'LOGISTICS', 'SALES', 'VALIDATOR']}><AppointmentDetails /></RequireRole>} />
          <Route path="financial" element={<RequireRole roles={['ADMIN']}><Financial /></RequireRole>} />
          <Route path="validation" element={<RequireRole roles={['ADMIN', 'VALIDATOR']}><Validation /></RequireRole>} />
          <Route path="technician" element={<RequireRole roles={['TECHNICIAN']}><TechnicianMobile /></RequireRole>} />
          <Route path="technician/calendar" element={<RequireRole roles={['TECHNICIAN']}><TechnicianCalendar /></RequireRole>} />
          <Route path="notifications" element={<RequireRole roles={['ADMIN']}><Notifications /></RequireRole>} />
          <Route path="technicians" element={<RequireRole roles={['ADMIN', 'LOGISTICS', 'SALES']}><Technicians /></RequireRole>} />
          <Route path="clients" element={<Navigate to={homeByRole(user?.role)} replace />} />
          <Route path="users" element={<RequireRole roles={['ADMIN']}><Users /></RequireRole>} />
          <Route path="vehicles" element={<RequireRole roles={['ADMIN', 'LOGISTICS']}><Vehicles /></RequireRole>} />
          <Route path="reports" element={<RequireRole roles={['ADMIN', 'LOGISTICS']}><Reports /></RequireRole>} />
          <Route path="settings" element={<RequireRole roles={['ADMIN']}><Settings /></RequireRole>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
