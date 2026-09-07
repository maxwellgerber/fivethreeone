// Small formatting helpers shared by the screens.

export function fmtW(w: number, units?: string): string {
  const s = Number.isInteger(w) ? String(w) : String(+w.toFixed(1));
  return units ? `${s} ${units}` : s;
}

export function fmtDate(iso: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, opts);
}

export function timeAgo(t: number, now = Date.now()): string {
  const s = Math.round((now - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return fmtDate(new Date(t).toISOString().slice(0, 10));
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function shareOrDownload(filename: string, text: string): Promise<void> {
  try {
    const file = new File([text], filename, { type: 'application/json' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
      await nav.share({ files: [file], title: filename });
      return;
    }
  } catch { /* fall through */ }
  downloadText(filename, text);
}
