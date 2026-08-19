export interface GitIdentity {
  name: string;
  email: string;
}

export interface GitHubIdentity {
  login: string;
  id: string;
  name: string;
}

export function missingTools(tools: string[], available: Set<string>): string[] {
  return tools.filter((tool) => !available.has(tool));
}

export function needsGitIdentity(identity: GitIdentity): boolean {
  return identity.name.length === 0 || identity.email.length === 0;
}

export function githubNoreplyEmail(id: string, login: string): string {
  if (!id || !login) return '';
  return `${id}+${login}@users.noreply.github.com`;
}

export function suggestedIdentity(
  current: GitIdentity,
  github: GitHubIdentity,
): GitIdentity {
  return {
    name: current.name || github.name || github.login,
    email: current.email || githubNoreplyEmail(github.id, github.login),
  };
}

export function versionToken(output: string, index: number): string {
  return output.trim().split(/\s+/)[index] ?? '';
}
