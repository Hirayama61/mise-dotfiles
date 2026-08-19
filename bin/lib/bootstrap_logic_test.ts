import {
  githubNoreplyEmail,
  missingTools,
  needsGitIdentity,
  suggestedIdentity,
  versionToken,
} from './bootstrap_logic.ts';

function assertEquals<T>(actual: T, expected: T): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test('missingTools returns only unavailable tools', () => {
  assertEquals(missingTools(['ghq', 'gh'], new Set(['gh'])), ['ghq']);
});

Deno.test('needsGitIdentity requires both name and email', () => {
  assertEquals(needsGitIdentity({ name: 'Aki', email: 'aki@example.com' }), false);
  assertEquals(needsGitIdentity({ name: 'Aki', email: '' }), true);
});

Deno.test('githubNoreplyEmail uses GitHub account id and login', () => {
  assertEquals(githubNoreplyEmail('123', 'aki'), '123+aki@users.noreply.github.com');
  assertEquals(githubNoreplyEmail('', 'aki'), '');
});

Deno.test('suggestedIdentity preserves existing values and fills missing values', () => {
  assertEquals(
    suggestedIdentity(
      { name: '', email: 'private@example.com' },
      { login: 'aki', id: '123', name: 'Aki H' },
    ),
    { name: 'Aki H', email: 'private@example.com' },
  );
});

Deno.test('versionToken extracts version from command output', () => {
  assertEquals(versionToken('git version 2.50.1', 2), '2.50.1');
  assertEquals(versionToken('Homebrew 4.6.0', 1), '4.6.0');
});
