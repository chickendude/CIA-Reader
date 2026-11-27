type Direction = 'ascending' | 'descending';
type Choice = readonly [value: string, label: string];

export interface SortColumn {
  key: string;
  label: string;
  first: Direction;
  ascending: Choice;
  descending: Choice;
}

export const accountColumns = [
  { key: 'email', label: 'Email', first: 'ascending', ascending: ['email-asc', 'Email A to Z'], descending: ['email-desc', 'Email Z to A'] },
  { key: 'name', label: 'Name', first: 'ascending', ascending: ['name', 'Name A to Z'], descending: ['name-desc', 'Name Z to A'] },
  { key: 'role', label: 'Role', first: 'ascending', ascending: ['role-asc', 'Role A to Z'], descending: ['role-desc', 'Role Z to A'] },
  { key: 'joined', label: 'Joined', first: 'descending', ascending: ['oldest', 'Oldest accounts'], descending: ['newest', 'Newest accounts'] },
  { key: 'verified', label: 'Verified', first: 'descending', ascending: ['unverified-first', 'Unverified first'], descending: ['verified-first', 'Verified first'] },
  { key: 'onboarded', label: 'Onboarded', first: 'descending', ascending: ['incomplete-first', 'Onboarding incomplete first'], descending: ['onboarded-first', 'Onboarded first'] },
  { key: 'links', label: 'Email links', first: 'descending', ascending: ['fewest-links', 'Fewest email links'], descending: ['most-links', 'Most email links'] },
  { key: 'texts', label: 'Texts', first: 'descending', ascending: ['fewest-texts', 'Fewest texts with activity'], descending: ['most-texts', 'Most texts with activity'] },
  { key: 'ips', label: 'IPs (48h)', first: 'descending', ascending: ['fewest-ips', 'Fewest IP addresses'], descending: ['most-ips', 'Most IP addresses'] },
] as const satisfies readonly SortColumn[];

export const groupColumns = [
  { key: 'network', label: 'IP group', first: 'ascending', ascending: ['group-asc', 'IP group A to Z'], descending: ['group-desc', 'IP group Z to A'] },
  { key: 'members', label: 'Users (48h)', first: 'descending', ascending: ['fewest', 'Fewest users'], descending: ['most', 'Most users'] },
  { key: 'signups', label: 'Signups (48h)', first: 'descending', ascending: ['fewest-signups', 'Fewest signups'], descending: ['most-signups', 'Most signups'] },
  { key: 'retries', label: 'Repeat attempts (7d)', first: 'descending', ascending: ['fewest-retries', 'Fewest repeat attempts'], descending: ['most-retries', 'Most repeat attempts'] },
  { key: 'lastRetry', label: 'Last repeat', first: 'descending', ascending: ['oldest-retry', 'Oldest repeat attempt'], descending: ['latest-retry', 'Latest repeat attempt'] },
  { key: 'latest', label: 'Last seen', first: 'descending', ascending: ['least-recent', 'Least recently seen'], descending: ['recent', 'Most recently seen'] },
] as const satisfies readonly SortColumn[];

export function activeDirection(column: SortColumn, value: string): Direction | undefined {
  if (column.ascending[0] === value) return 'ascending';
  if (column.descending[0] === value) return 'descending';
}

export function resolveSort<C extends SortColumn>(columns: readonly C[], raw: string | null, fallback: C['key']) {
  const column = columns.find(c => raw && activeDirection(c, raw)) ?? columns.find(c => c.key === fallback)!;
  const direction = activeDirection(column, raw ?? '') ?? column.first;
  return { key: column.key as C['key'], direction, value: column[direction][0] };
}
