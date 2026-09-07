// Bottom sheet. `open(<Content/>)` shows it; content components own their state.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

interface SheetApi {
  open: (content: ReactNode) => void;
  close: () => void;
}
const SheetContext = createContext<SheetApi | null>(null);

export function SheetProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode>(null);
  const open = useCallback((c: ReactNode) => setContent(c), []);
  const close = useCallback(() => setContent(null), []);
  const api = useMemo(() => ({ open, close }), [open, close]);
  return (
    <SheetContext.Provider value={api}>
      {children}
      {content && <SheetHost onClose={close}>{content}</SheetHost>}
    </SheetContext.Provider>
  );
}

function SheetHost({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[autofocus]')?.focus();
  }, []);
  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" ref={ref}>{children}</div>
    </div>
  );
}

export function useSheet(): SheetApi {
  const api = useContext(SheetContext);
  if (!api) throw new Error('useSheet outside SheetProvider');
  return api;
}
