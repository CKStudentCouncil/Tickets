// Helpers and design tokens shared by every email template.

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeHtmlPreserveBreaks(value) {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

// Solid colours (no rgba) so every mail client renders the same.
export const C = {
  bg: '#050608',
  text: '#f2f0e9',
  muted: '#8e8e8a',
  lunar: '#9aa3ac',
  ember: '#e4a468',
  line: '#26292c',
  lineSoft: '#181a1d',
  dashed: '#474a4c',
  boxBg: '#0b0c0e',
  footer: '#70757c'
};

export const FONT =
  "'Manrope','Noto Sans TC','PingFang TC','Microsoft JhengHei',Arial,sans-serif";

export const MONO = "'SF Mono',Consolas,Menlo,monospace";

export function sectionLabel(marginBottom = 22) {
  return `margin:0 0 ${marginBottom}px;font-family:${FONT};font-size:11px;font-weight:700;line-height:1.4;letter-spacing:.28em;text-transform:uppercase;color:${C.ember};`;
}
