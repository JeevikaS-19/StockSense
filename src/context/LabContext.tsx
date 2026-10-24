import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Lab } from '../types/index.ts';
import { useAuth } from './AuthContext.tsx';
import { api, errorMessage } from '../api/client.ts';

// 'all' is the admin's consolidated view. null means the user has no laboratory yet.
export type ActiveLab = number | 'all' | null;

interface LabContextType {
  labs: Lab[];
  labsReady: boolean;
  labsError: string | null;
  activeLabId: ActiveLab;
  activeLab: Lab | null;
  setActiveLabId: (id: ActiveLab) => void;
  refreshLabs: () => Promise<void>;
}

const LabContext = createContext<LabContextType | undefined>(undefined);
const ACTIVE_LAB_KEY = 'stocksense_active_lab_id';

function storedLab(): string | null {
  try {
    return localStorage.getItem(ACTIVE_LAB_KEY);
  } catch {
    return null;
  }
}

export const LabProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [labs, setLabs] = useState<Lab[]>([]);
  const [labsReady, setLabsReady] = useState(false);
  const [labsError, setLabsError] = useState<string | null>(null);
  const [activeLabId, setActiveLabIdState] = useState<ActiveLab>(null);

  const refreshLabs = useCallback(async () => {
    if (!user) return;
    setLabsError(null);
    try {
      const res = await api.labs.list();
      const loaded: Lab[] = res.labs || [];
      setLabs(loaded);

      // Restore the last choice if it is still valid for this user; otherwise pick a sensible default.
      const stored = storedLab();
      let next: ActiveLab;
      if (stored === 'all' && user.role === 'admin') next = 'all';
      else if (stored && loaded.some((lab) => lab.id === Number(stored))) next = Number(stored);
      else if (user.role === 'admin') next = loaded.length > 0 ? 'all' : null;
      else next = loaded[0]?.id ?? null;
      setActiveLabIdState(next);
    } catch (err) {
      setLabsError(errorMessage(err, 'Could not load your laboratories.'));
    } finally {
      setLabsReady(true);
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setLabs([]);
      setLabsReady(false);
      setActiveLabIdState(null);
      return;
    }
    setLabsReady(false);
    refreshLabs();
  }, [user, refreshLabs]);

  const setActiveLabId = (id: ActiveLab) => {
    if (id === 'all' && user?.role !== 'admin') return;
    setActiveLabIdState(id);
    try {
      localStorage.setItem(ACTIVE_LAB_KEY, String(id));
    } catch {
      /* the choice still applies for this session */
    }
  };

  const activeLab = typeof activeLabId === 'number' ? labs.find((lab) => lab.id === activeLabId) ?? null : null;

  return (
    <LabContext.Provider value={{ labs, labsReady, labsError, activeLabId, activeLab, setActiveLabId, refreshLabs }}>
      {children}
    </LabContext.Provider>
  );
};

export const useLab = () => {
  const context = useContext(LabContext);
  if (!context) throw new Error('useLab must be used within a LabProvider');
  return context;
};
