import { ICON_COLOR, ICON_PLAIN, ICON_WIDTH } from './logo-data.js';

const WORD = [
  '██████╗  █████╗  ██████╗███████╗██╗   ██╗██╗',
  '██╔══██╗██╔══██╗██╔════╝██╔════╝██║   ██║██║',
  '██████╔╝███████║██║     █████╗  ██║   ██║██║',
  '██╔══██╗██╔══██║██║     ██╔══╝  ██║   ██║██║',
  '██║  ██║██║  ██║╚██████╗███████╗╚██████╔╝██║',
  '╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚══════╝ ╚═════╝ ╚═╝',
];
/** Column where "UI" starts in WORD (rendered in the logo's blue). */
const UI_COL = 32;
const BLUE = '\x1b[38;2;10;108;240m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

export const TAGLINE = 'Two users. One resource. Zero room for bugs.';

export function supportsColor(stream: NodeJS.WriteStream = process.stdout): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '0') return true;
  return !!stream.isTTY && process.env.TERM !== 'dumb';
}

/**
 * The RaceUI logo (browser icon from assets/raceui-logo.png + wordmark) for terminal output.
 * Truecolor half-block rendering when the terminal supports color, plain blocks otherwise.
 */
export function renderLogo(version: string, color = supportsColor()): string {
  const icon = color ? ICON_COLOR : ICON_PLAIN;
  const top = Math.max(0, Math.floor((icon.length - WORD.length) / 2) - 1);
  const lines: string[] = [];
  for (let i = 0; i < icon.length; i++) {
    const w = WORD[i - top];
    let right = '';
    if (w !== undefined) {
      right = color ? `${BOLD}${w.slice(0, UI_COL)}${RESET}${BOLD}${BLUE}${w.slice(UI_COL)}${RESET}` : w;
    } else if (i - top === WORD.length) {
      right = color ? `${DIM}${TAGLINE}  v${version}${RESET}` : `${TAGLINE}  v${version}`;
    }
    const left = color ? (icon[i] ?? '') : (icon[i] ?? '').padEnd(ICON_WIDTH);
    lines.push(`${left}${color ? ''.padEnd(ICON_WIDTH - visibleWidth(icon[i] ?? '')) : ''}   ${right}`.trimEnd());
  }
  return lines.join('\n');
}

function visibleWidth(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}
