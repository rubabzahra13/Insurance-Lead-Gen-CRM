import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { DeskProvider } from './context/DeskContext.jsx';
import AppLayout from './layouts/AppLayout.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import LeadsPage from './pages/LeadsPage.jsx';
import { ROUTES } from './lib/desk-routes.js';

export default function App() {
  return (
    <BrowserRouter>
      <DeskProvider>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path={ROUTES.dashboard} element={<DashboardPage />} />
            <Route path={ROUTES.leads} element={<LeadsPage />} />
            <Route path={ROUTES.leadsNew} element={<LeadsPage />} />
            <Route path={ROUTES.leadsStarred} element={<LeadsPage />} />
            <Route path={ROUTES.leadsReview} element={<LeadsPage />} />
            <Route path="*" element={<Navigate to={ROUTES.dashboard} replace />} />
          </Route>
        </Routes>
      </DeskProvider>
    </BrowserRouter>
  );
}
