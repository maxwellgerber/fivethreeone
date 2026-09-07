import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

const ToastContext = createContext<((msg: string) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const toast = useCallback((m: string) => {
    setMsg(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 2200);
  }, []);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div id="toast" className="toast" hidden={msg === null}>{msg}</div>
    </ToastContext.Provider>
  );
}

export function useToast(): (msg: string) => void {
  const t = useContext(ToastContext);
  if (!t) throw new Error('useToast outside ToastProvider');
  return t;
}
