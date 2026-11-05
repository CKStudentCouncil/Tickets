// Chart colours, as SVG attributes (src/components/analytics): the admin's
// dark theme on screen, ink on white in the PDF. `current` is the accent
// (this year, or a lone series); `previous` the year it's compared with,
// grey context (contrast checked against both backgrounds). `groups` are
// categorical slots, validated as a palette against each background;
// `groupText` is the label colour inside each. 路宣's crimson (between 教師
// and 其他) clears both neighbours; on screen it is nearer 北一女中 and 家長,
// which the legend table names. Lines that cross take only groups[0–2]:
// those three stay apart in every pair, also for colour-blind readers.
export const SCREEN_PALETTE = {
  surface: '#0a0b0d', grid: '#1b1e23', axis: '#3b4048', text: '#d9d7d0', muted: '#8d959e',
  current: '#e4a468', previous: '#7d848c',
  groups: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#8066cc', '#14a6b8', '#a97845', '#ac2f3b', '#707780'],
  groupText: ['#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff']
}

export const PRINT_PALETTE = {
  surface: '#ffffff', grid: '#ececf0', axis: '#c7c7cc', text: '#1d1d1f', muted: '#6e6e73',
  current: '#b35f17', previous: '#8a9097',
  groups: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#8066cc', '#14a6b8', '#a97845', '#ba0135', '#707780'],
  groupText: ['#ffffff', '#ffffff', '#ffffff', '#0b0b0b', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff']
}
