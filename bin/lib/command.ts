const decoder = new TextDecoder();

export interface CommandOutput {
  code: number;
  stdout: string;
  stderr: string;
}

export class CommandRunner {
  async output(command: string, args: string[] = []): Promise<CommandOutput> {
    const result = await new Deno.Command(command, {
      args,
      stdout: 'piped',
      stderr: 'piped',
    }).output();

    return {
      code: result.code,
      stdout: decoder.decode(result.stdout),
      stderr: decoder.decode(result.stderr),
    };
  }

  async succeeds(command: string, args: string[] = []): Promise<boolean> {
    try {
      return (await this.output(command, args)).code === 0;
    } catch {
      return false;
    }
  }

  async text(command: string, args: string[] = []): Promise<string> {
    const result = await this.output(command, args);
    if (result.code !== 0) {
      throw new Error(`${command} failed (${result.code}): ${result.stderr.trim()}`);
    }
    return result.stdout.trim();
  }

  async textOrEmpty(command: string, args: string[] = []): Promise<string> {
    const result = await this.output(command, args);
    return result.code === 0 ? result.stdout.trim() : '';
  }

  async inherit(command: string, args: string[] = []): Promise<void> {
    const child = new Deno.Command(command, {
      args,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    }).spawn();
    const status = await child.status;
    if (!status.success) {
      throw new Error(`${command} failed (${status.code})`);
    }
  }

  async exists(command: string): Promise<boolean> {
    return await this.succeeds('/usr/bin/which', [command]);
  }
}
