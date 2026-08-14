import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { configApi } from '../api/endpoints.js';
import { applyBrandShades, applyFavicon } from '../lib/brand.js';

const BrandContext = createContext(null);

const DEFAULT_BRANDING = { name: 'SalesDesk', brandColor: '#4f46e5', logoUrl: null, faviconUrl: null, domain: null };

function applyDocumentBranding(branding) {
  applyBrandShades(branding.brandColor);
  applyFavicon(branding.faviconUrl);
  document.title = branding.name ? `${branding.name} · CRM` : 'CRM';
}

export function BrandProvider({ children }) {
  const [branding, setBranding] = useState(DEFAULT_BRANDING);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const cfg = await configApi.get();
      const next = {
        name: cfg.name || DEFAULT_BRANDING.name,
        brandColor: cfg.brandColor || DEFAULT_BRANDING.brandColor,
        logoUrl: cfg.logoUrl,
        faviconUrl: cfg.faviconUrl,
        domain: cfg.domain,
        company: cfg.company,
      };
      setBranding(next);
      applyDocumentBranding(next);
    } catch {
      /* keep defaults */
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    applyDocumentBranding(DEFAULT_BRANDING);
    refresh();
  }, [refresh]);

  // Let the auth flow refine branding from the tenant returned by login/me.
  const setTenantBranding = useCallback((tenant) => {
    if (!tenant) return;
    const next = {
      name: tenant.name || branding.name,
      brandColor: tenant.brandColor || branding.brandColor,
      logoUrl: tenant.logoUrl ?? branding.logoUrl,
      faviconUrl: tenant.faviconUrl ?? branding.faviconUrl,
      domain: tenant.domain ?? branding.domain,
      company: tenant,
    };
    setBranding(next);
    applyDocumentBranding(next);
  }, [branding.name, branding.brandColor, branding.logoUrl, branding.faviconUrl, branding.domain]);

  const value = useMemo(
    () => ({ branding, ready, refresh, setTenantBranding }),
    [branding, ready, refresh, setTenantBranding]
  );

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>;
}

export function useBranding() {
  const ctx = useContext(BrandContext);
  if (!ctx) throw new Error('useBranding must be used within BrandProvider');
  return ctx;
}
