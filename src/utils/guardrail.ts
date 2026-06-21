// Write guardrail (fork): diff + journaling + dry-run on every contact write.
// Deliberately isolated in a single module to keep upstream (domdomegg) rebases easy.
import {appendFileSync} from 'node:fs';

/** Subset of the People API fields our write tools manipulate. */
export type PeoplePerson = {
	names?: {givenName?: string; familyName?: string; displayName?: string}[];
	emailAddresses?: {value?: string; type?: string}[];
	phoneNumbers?: {value?: string; type?: string}[];
	organizations?: {name?: string; title?: string}[];
	biographies?: {value?: string}[];
};

export type DiffRow = {field: string; before: string; after: string};

/** Scalar fields compared (stable order for diff display). */
const FIELDS = ['givenName', 'familyName', 'emails', 'phones', 'organization', 'jobTitle', 'notes'] as const;

/** personFields to request on GET to reconstruct the "before" state. */
export const DIFF_PERSON_FIELDS = 'names,emailAddresses,phoneNumbers,organizations,biographies';

export function isDryRun(): boolean {
	return process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
}

/** Flattens a People API person into a map of comparable scalar fields. */
export function extractFields(person: PeoplePerson | undefined): Record<string, string> {
	const p = person ?? {};
	const join = (arr: {value?: string}[] | undefined): string => (arr ?? []).map((x) => x.value).filter(Boolean).join(', ');
	return {
		givenName: p.names?.[0]?.givenName ?? '',
		familyName: p.names?.[0]?.familyName ?? '',
		emails: join(p.emailAddresses),
		phones: join(p.phoneNumbers),
		organization: p.organizations?.[0]?.name ?? '',
		jobTitle: p.organizations?.[0]?.title ?? '',
		notes: p.biographies?.[0]?.value ?? '',
	};
}

export function computeDiff(before: Record<string, string>, after: Record<string, string>): DiffRow[] {
	const rows: DiffRow[] = [];
	for (const field of FIELDS) {
		const b = before[field] ?? '';
		const a = after[field] ?? '';
		if (b !== a) {
			rows.push({field, before: b, after: a});
		}
	}

	return rows;
}

export function displayName(fields: Record<string, string>): string {
	return [fields.givenName, fields.familyName].filter(Boolean).join(' ') || '(sans nom)';
}

function nowIso(): string {
	return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

/** Escapes a value for a Markdown table cell. */
function escapeCell(value: string): string {
	return (value || '—').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/**
 * Appends a timestamped entry to the sync journal (VAULT_JOURNAL_PATH).
 * Guarantees the trace is written BEFORE the real write; no silent writes.
 */
export function writeJournalEntry(params: {
	op: string;
	status: 'DRY-RUN' | 'OK' | 'ÉCHEC';
	name: string;
	resourceName?: string;
	diff: DiffRow[];
	trigger?: string;
}): void {
	const path = process.env.VAULT_JOURNAL_PATH;
	if (!path) {
		console.error('guardrail: VAULT_JOURNAL_PATH not set — diff not journaled');
		return;
	}

	const rows = params.diff.length
		? params.diff.map((d) => `| ${d.field} | ${escapeCell(d.before)} | ${escapeCell(d.after)} |`).join('\n')
		: '| _(aucun changement de champ)_ | | |';

	const entry = [
		'',
		`### ${nowIso()} · ${params.op} · [${params.status}]`,
		`- **Contact** : ${params.name}${params.resourceName ? ` (\`${params.resourceName}\`)` : ''}`,
		...(params.trigger ? [`- **Déclencheur** : ${params.trigger}`] : []),
		'',
		'| Champ | Avant | Après |',
		'|---|---|---|',
		rows,
		'',
	].join('\n');

	try {
		appendFileSync(path, entry, 'utf8');
	} catch (error) {
		console.error(`guardrail: failed to write journal (${path}):`, error);
	}
}
