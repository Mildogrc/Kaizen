// Apply the saved theme before first paint (no flash). A file rather than an
// inline script so the Content-Security-Policy can forbid inline scripts.
try {
  const t = localStorage.getItem('kaizen.theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch {}
