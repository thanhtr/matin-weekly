import { useEffect, useState } from 'react';
import { api } from './api';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { AdminLoginPage } from './pages/AdminLoginPage';
import { PrintRosterPage } from './pages/PrintRosterPage';

export function App() {
  const [path, setPath] = useState(() => window.location.pathname);
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  function navigate(nextPath: string) {
    window.history.pushState({}, '', nextPath);
    setPath(nextPath);
  }

  useEffect(() => {
    api
      .checkAuth()
      .then((res) => setAuthed(res.authenticated))
      .catch(() => setAuthed(false));
  }, [path]);

  if (authed === null) {
    return <div className="container">Loading...</div>;
  }

  if (!authed) {
    return (
      <AdminLoginPage
        onSuccess={() => {
          setAuthed(true);
          if (path === '/' || path === '/admin/login') {
            navigate('/admin');
          }
        }}
      />
    );
  }

  const printMatch = path.match(/^\/admin\/events\/([^/]+)\/print$/);
  if (printMatch) {
    return <PrintRosterPage eventId={printMatch[1]} onBack={() => navigate('/admin')} />;
  }

  return (
    <AdminDashboardPage
      onLogout={() => {
        setAuthed(false);
        navigate('/admin/login');
      }}
      onOpenPrint={(eventId) => navigate(`/admin/events/${eventId}/print`)}
    />
  );
}
