// Rest timer: counts down, beeps/vibrates at zero, shows "GO" for a minute after.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from './store.tsx';

interface TimerState { endsAt: number; total: number; label: string }
interface TimerApi {
  start: (seconds: number, label: string) => void;
  stop: () => void;
  add: (seconds: number) => void;
}
const TimerContext = createContext<TimerApi | null>(null);

export function TimerProvider({ children }: { children: ReactNode }) {
  const [timer, setTimer] = useState<TimerState | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const { current } = useStore();

  const start = useCallback((seconds: number, label: string) => {
    if (seconds <= 0) return;
    const { sound } = current().settings;
    if (!audio.current && sound) {
      try {
        audio.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      } catch { /* no audio */ }
    }
    if (audio.current?.state === 'suspended') void audio.current.resume();
    setTimer({ endsAt: Date.now() + seconds * 1000, total: seconds, label });
  }, [current]);
  const stop = useCallback(() => setTimer(null), []);
  const add = useCallback((seconds: number) => setTimer((t) => (t ? { ...t, endsAt: t.endsAt + seconds * 1000 } : t)), []);
  const api = useMemo(() => ({ start, stop, add }), [start, stop, add]);

  const beep = useCallback(() => {
    const { vibrate, sound } = current().settings;
    if (vibrate && 'vibrate' in navigator) navigator.vibrate([200, 100, 200]);
    const ac = audio.current;
    if (!ac || !sound) return;
    const now = ac.currentTime;
    for (let i = 0; i < 3; i++) {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, now + i * 0.25);
      g.gain.exponentialRampToValueAtTime(0.4, now + i * 0.25 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.25 + 0.2);
      o.connect(g).connect(ac.destination);
      o.start(now + i * 0.25);
      o.stop(now + i * 0.25 + 0.22);
    }
  }, [current]);

  return (
    <TimerContext.Provider value={api}>
      {children}
      <div id="timer">{timer && <TimerBar timer={timer} onBeep={beep} api={api} />}</div>
    </TimerContext.Provider>
  );
}

function TimerBar({ timer, onBeep, api }: { timer: TimerState; onBeep: () => void; api: TimerApi }) {
  const [now, setNow] = useState(Date.now());
  const fired = useRef(false);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  useEffect(() => { fired.current = false; }, [timer.endsAt]);
  const rem = Math.ceil((timer.endsAt - now) / 1000);
  const over = rem <= 0;
  useEffect(() => {
    if (over && !fired.current) { fired.current = true; onBeep(); }
    if (over && Math.abs(rem) > 60) api.stop();
  }, [over, rem, onBeep, api]);
  const abs = Math.abs(rem);
  const mm = Math.floor(abs / 60);
  const ss = String(abs % 60).padStart(2, '0');
  return (
    <div className={`bar${over ? ' over' : ''}`}>
      <div className="t">{over ? 'GO' : `${mm}:${ss}`}<small>{over ? `rest done · ${timer.label}` : timer.label}</small></div>
      <button type="button" data-action="timer-add" onClick={() => api.add(30)}>+30</button>
      <button type="button" data-action="timer-stop" aria-label="Dismiss timer" onClick={api.stop}>✕</button>
    </div>
  );
}

export function useTimer(): TimerApi {
  const t = useContext(TimerContext);
  if (!t) throw new Error('useTimer outside TimerProvider');
  return t;
}
