import { useState, type FormEvent } from 'react';
import { Lock } from 'lucide-react';
import { api } from '../api';

export function AdminLoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.login(password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container narrow" style={{ marginTop: 48 }}>
      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <Lock size={20} />
          <h1 style={{ margin: 0, fontSize: 20 }}>Admin Dashboard Login</h1>
        </div>
        <p style={{ marginTop: 0, color: 'var(--muted)', fontSize: 14 }}>
          Enter the admin password to manage badminton schedules, player emails, and signups.
        </p>
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label className="label" htmlFor="admin-password">
              Password
            </label>
            <input
              id="admin-password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
