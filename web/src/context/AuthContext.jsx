import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { authApi } from '../api/endpoints.js';
import { getToken, setToken } from '../api/client.js';
import { useBranding } from './BrandContext.jsx';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);
  const { setTenantBranding } = useBranding();

  const clearSession = useCallback(() => {
    setToken(null);
    setUser(null);
    setTenant(null);
  }, []);

  useEffect(() => {
    let active = true;
    async function bootstrap() {
      if (!getToken()) {
        setLoading(false);
        return;
      }
      try {
        const data = await authApi.me();
        if (active) {
          setUser(data.user);
          setTenant(data.tenant || null);
          setTenantBranding(data.tenant);
        }
      } catch {
        clearSession();
      } finally {
        if (active) setLoading(false);
      }
    }
    bootstrap();

    const onUnauthorized = () => {
      setUser(null);
      setTenant(null);
    };
    window.addEventListener('crm:unauthorized', onUnauthorized);
    return () => {
      active = false;
      window.removeEventListener('crm:unauthorized', onUnauthorized);
    };
  }, [clearSession, setTenantBranding]);

  const login = useCallback(
    async (email, password) => {
      const data = await authApi.login(email, password);
      setToken(data.token);
      setUser(data.user);
      setTenant(data.tenant || null);
      setTenantBranding(data.tenant);
      return data.user;
    },
    [setTenantBranding]
  );

  const acceptInvite = useCallback(
    async (token, password) => {
      const data = await authApi.acceptInvite(token, password);
      setToken(data.token);
      setUser(data.user);
      setTenant(data.tenant || null);
      setTenantBranding(data.tenant);
      return data.user;
    },
    [setTenantBranding]
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      /* ignore network errors during logout */
    }
    clearSession();
  }, [clearSession]);

  const refreshUser = useCallback(async () => {
    const data = await authApi.me();
    setUser(data.user);
    setTenant(data.tenant || null);
    setTenantBranding(data.tenant);
    return data.user;
  }, [setTenantBranding]);

  const setPassword = useCallback(async (newPassword) => {
    await authApi.setPassword(newPassword);
    const data = await authApi.me();
    setUser(data.user);
    setTenant(data.tenant || null);
    setTenantBranding(data.tenant);
    return data.user;
  }, [setTenantBranding]);

  const value = { user, tenant, loading, login, acceptInvite, logout, refreshUser, setUser, setPassword };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function can(user, permission) {
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  return user.permissions?.includes(permission) || user.permissions?.includes('*');
}
