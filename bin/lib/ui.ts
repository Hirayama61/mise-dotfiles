import { PANDA, type PandaColor } from './palette.ts';

const encoder = new TextEncoder();
const SPINNER_FRAMES = [...'⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'];

function write(text: string): void {
  Deno.stdout.writeSync(encoder.encode(text));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class UI {
  readonly usesColor = Deno.stdout.isTerminal() && !Deno.env.get('NO_COLOR');
  readonly lineDelay = Number(Deno.env.get('UI_LINE_DELAY') ?? '0.06') * 1000;

  private color(value: PandaColor): string {
    if (!this.usesColor) return '';
    const [red, green, blue] = value.split(' ');
    return `\x1b[38;2;${red};${green};${blue}m`;
  }

  private reset(): string {
    return this.usesColor ? '\x1b[0m' : '';
  }

  private async pause(): Promise<void> {
    if (this.usesColor && this.lineDelay > 0) await sleep(this.lineDelay);
  }

  private gradient(text: string, from: PandaColor, to: PandaColor): string {
    if (!this.usesColor) return text;
    const start = from.split(' ').map(Number);
    const end = to.split(' ').map(Number);
    const chars = [...text];
    const last = Math.max(chars.length - 1, 1);

    return chars.map((char, index) => {
      const rgb = start.map((value, channel) =>
        Math.round(value + ((end[channel] - value) * index) / last)
      );
      return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${char}`;
    }).join('') + this.reset();
  }

  async banner(subtitle: string): Promise<void> {
    write(`\n  ${this.gradient('┏┳┓╻┏━┓┏━╸   ╺┳┓┏━┓╺┳╸┏━╸╻╻  ┏━╸┏━┓', PANDA.pink, PANDA.purpleLift)}\n`);
    await this.pause();
    write(`  ${this.gradient('┃┃┃┃┗━┓┣╸     ┃┃┃ ┃ ┃ ┣╸ ┃┃  ┣╸ ┗━┓', PANDA.purpleLift, PANDA.blueLift)}\n`);
    await this.pause();
    write(`  ${this.gradient('╹ ╹╹┗━┛┗━╸   ╺┻┛┗━┛ ╹ ╹  ╹┗━╸┗━╸┗━┛', PANDA.blueLift, PANDA.mint)}\n\n`);
    await this.pause();
    write(`  ${this.color(PANDA.grayLift)}${subtitle}${this.reset()}\n\n`);
    await this.pause();
  }

  async section(title: string): Promise<void> {
    write(`\n${this.color(PANDA.subtle)}   ${title}${this.reset()}\n\n`);
    await this.pause();
  }

  async status(state: 'ok' | 'kept', label: string, detail: string, child = false): Promise<void> {
    const indent = child ? '     ' : '   ';
    const width = child ? 12 : 14;
    const marker = state === 'ok'
      ? `${this.color(PANDA.mint)}✓ `
      : `${this.color(PANDA.subtle)}· `;
    write(`${indent}${marker}${this.color(PANDA.fg)}${label.padEnd(width)}${this.color(PANDA.grayLift)}${detail}${this.reset()}\n`);
    await this.pause();
  }

  async note(message: string): Promise<void> {
    write(`${this.color(PANDA.grayLift)}   ${message}${this.reset()}\n`);
    await this.pause();
  }

  async ready(message: string): Promise<void> {
    write(`\n${this.color(PANDA.mint)}   ready.${this.color(PANDA.grayLift)}  ${message}${this.reset()}\n\n`);
    await this.pause();
  }

  async nextStep(command: string, description: string): Promise<void> {
    const padding = Math.max(24 - [...command].length, 2);
    write(`${this.color(PANDA.cyan)}     ${command}${this.color(PANDA.subtle)}${' '.repeat(padding)}${description}${this.reset()}\n`);
    await this.pause();
  }

  ask(label: string, defaultValue: string): string {
    while (true) {
      const answer = prompt(`   ${label.padEnd(8)}[${defaultValue}] >`) ?? '';
      const value = answer.trim() || defaultValue;
      if (value) return value;
    }
  }

  confirm(message: string): boolean {
    const answer = (prompt(`   ${message} [Y/n]`) ?? '').trim();
    return answer === '' || /^[Yy]/.test(answer);
  }

  async run(label: string, detail: string, task: () => Promise<void>): Promise<void> {
    if (!this.usesColor) {
      await task();
      return;
    }

    let frame = 0;
    write('\x1b[?25l');
    const timer = setInterval(() => {
      const spinner = SPINNER_FRAMES[frame % SPINNER_FRAMES.length];
      write(`\r${this.color(PANDA.mint)}   ${spinner} ${this.color(PANDA.fg)}${label.padEnd(14)}${this.color(PANDA.grayLift)}${detail}${this.reset()}`);
      frame += 1;
    }, 100);

    try {
      await task();
    } finally {
      clearInterval(timer);
      write('\r\x1b[K\x1b[?25h');
    }
  }

  async clipboard(command: string): Promise<void> {
    try {
      const child = new Deno.Command('pbcopy', { stdin: 'piped' }).spawn();
      const writer = child.stdin.getWriter();
      await writer.write(encoder.encode(`${command}\n`));
      await writer.close();
      const status = await child.status;
      if (!status.success) return;
      write(`${this.color(PANDA.pink)}   📋 ${this.color(PANDA.grayLift)}クリップボードに入れました${this.reset()}\n`);
      await this.pause();
    } catch {
      // SSH セッションなど pbcopy が無い環境では表示だけにする。
    }
  }
}
