import {z} from 'zod';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {Config} from './types.js';
import {makePeopleApiCall} from '../utils/contacts-api.js';
import {jsonResult} from '../utils/response.js';
import {strictSchemaWithAliases} from '../utils/schema.js';
import {
	computeDiff, DIFF_PERSON_FIELDS, displayName, extractFields, isDryRun, writeJournalEntry, type PeoplePerson,
} from '../utils/guardrail.js';

const inputSchema = strictSchemaWithAliases({
	resourceName: z.string().describe('The resource name of the contact to delete (e.g., "people/c12345")'),
}, {});

const outputSchema = z.object({
	success: z.boolean(),
	message: z.string(),
});

export function registerContactDelete(server: McpServer, config: Config): void {
	server.registerTool(
		'contact_delete',
		{
			title: 'Delete contact',
			description: 'Permanently delete a contact from Google Contacts.',
			inputSchema,
			outputSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: true,
			},
		},
		async ({resourceName}) => {
			// Guardrail: journal what will be deleted ("before" state), diff to empty, dry-run.
			let before: Record<string, string> = {};
			let name = resourceName;
			try {
				const beforeParams = new URLSearchParams({personFields: DIFF_PERSON_FIELDS});
				const beforeRaw = await makePeopleApiCall('GET', `/${resourceName}?${beforeParams.toString()}`, config.token) as PeoplePerson;
				before = extractFields(beforeRaw);
				name = displayName(before);
			} catch {
				// Contact not found / unreadable: keep the resourceName as the label.
			}

			const diff = computeDiff(before, extractFields(undefined));

			if (isDryRun()) {
				writeJournalEntry({op: 'contact_delete', status: 'DRY-RUN', name, resourceName, diff});
				return jsonResult({success: true, message: `DRY-RUN : contact ${resourceName} NON supprimé (diff journalisé)`});
			}

			try {
				await makePeopleApiCall('DELETE', `/${resourceName}:deleteContact`, config.token);
				writeJournalEntry({op: 'contact_delete', status: 'OK', name, resourceName, diff});
				return jsonResult({success: true, message: `Contact ${resourceName} deleted successfully`});
			} catch (error) {
				writeJournalEntry({op: 'contact_delete', status: 'ÉCHEC', name, resourceName, diff});
				throw error;
			}
		},
	);
}
