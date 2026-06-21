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
	resourceName: z.string().describe('The resource name of the contact to update (e.g., "people/c12345")'),
	etag: z.string().describe('The etag from the contact (required to prevent conflicts)'),
	givenName: z.string().optional().describe('First name'),
	familyName: z.string().optional().describe('Last name'),
	emailAddresses: z.array(z.object({
		value: z.string().describe('Email address'),
		type: z.string().optional().describe('Type of email. Predefined values are "home", "work", or "other"; any other string is treated as a custom label.'),
	})).optional().describe('Email addresses (replaces existing)'),
	phoneNumbers: z.array(z.object({
		value: z.string().describe('Phone number'),
		type: z.string().optional().describe('Type of phone. Predefined values are "home", "work", "mobile", "homeFax", "workFax", "otherFax", "pager", "workMobile", "workPager", "main", "googleVoice", or "other"; any other string is treated as a custom label.'),
	})).optional().describe('Phone numbers (replaces existing)'),
	organization: z.string().optional().describe('Company/organization name'),
	jobTitle: z.string().optional().describe('Job title'),
	notes: z.string().optional().describe('Notes about the contact'),
}, {});

const outputSchema = z.object({
	resourceName: z.string(),
	etag: z.string().optional(),
	names: z.array(z.object({
		displayName: z.string().optional(),
		givenName: z.string().optional(),
		familyName: z.string().optional(),
	})).optional(),
	emailAddresses: z.array(z.object({
		value: z.string().optional(),
		type: z.string().optional(),
	})).optional(),
	phoneNumbers: z.array(z.object({
		value: z.string().optional(),
		type: z.string().optional(),
	})).optional(),
}).passthrough();

export function registerContactUpdate(server: McpServer, config: Config): void {
	server.registerTool(
		'contact_update',
		{
			title: 'Update contact',
			description: 'Update an existing contact. Use contact_get first to retrieve the current etag.',
			inputSchema,
			outputSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: true,
				idempotentHint: true,
			},
		},
		async ({resourceName, etag, givenName, familyName, emailAddresses, phoneNumbers, organization, jobTitle, notes}) => {
			const person: Record<string, unknown> = {etag};
			const updatePersonFields: string[] = [];

			if (givenName !== undefined || familyName !== undefined) {
				person.names = [{givenName, familyName}];
				updatePersonFields.push('names');
			}

			if (emailAddresses !== undefined) {
				person.emailAddresses = emailAddresses;
				updatePersonFields.push('emailAddresses');
			}

			if (phoneNumbers !== undefined) {
				person.phoneNumbers = phoneNumbers;
				updatePersonFields.push('phoneNumbers');
			}

			if (organization !== undefined || jobTitle !== undefined) {
				person.organizations = [{name: organization, title: jobTitle}];
				updatePersonFields.push('organizations');
			}

			if (notes !== undefined) {
				person.biographies = [{value: notes, contentType: 'TEXT_PLAIN'}];
				updatePersonFields.push('biographies');
			}

			const params = new URLSearchParams();
			params.set('updatePersonFields', updatePersonFields.join(','));

			// Guardrail: "before" state via GET, diff on the provided fields only, journal + dry-run.
			const beforeParams = new URLSearchParams({personFields: DIFF_PERSON_FIELDS});
			const beforeRaw = await makePeopleApiCall('GET', `/${resourceName}?${beforeParams.toString()}`, config.token) as PeoplePerson;
			const before = extractFields(beforeRaw);
			const after = {...before};
			if (givenName !== undefined) {
				after.givenName = givenName;
			}

			if (familyName !== undefined) {
				after.familyName = familyName;
			}

			if (emailAddresses !== undefined) {
				after.emails = emailAddresses.map((e: {value: string}) => e.value).filter(Boolean).join(', ');
			}

			if (phoneNumbers !== undefined) {
				after.phones = phoneNumbers.map((p: {value: string}) => p.value).filter(Boolean).join(', ');
			}

			if (organization !== undefined) {
				after.organization = organization;
			}

			if (jobTitle !== undefined) {
				after.jobTitle = jobTitle;
			}

			if (notes !== undefined) {
				after.notes = notes;
			}

			const diff = computeDiff(before, after);
			const name = displayName(after);

			if (isDryRun()) {
				writeJournalEntry({op: 'contact_update', status: 'DRY-RUN', name, resourceName, diff});
				return jsonResult({resourceName, dryRun: true, message: `DRY-RUN : contact "${name}" NON modifié (diff journalisé)`, diff});
			}

			try {
				const result = await makePeopleApiCall('PATCH', `/${resourceName}:updateContact?${params.toString()}`, config.token, person);
				const parsed = outputSchema.parse(result);
				writeJournalEntry({op: 'contact_update', status: 'OK', name, resourceName, diff});
				return jsonResult(parsed);
			} catch (error) {
				writeJournalEntry({op: 'contact_update', status: 'ÉCHEC', name, resourceName, diff});
				throw error;
			}
		},
	);
}
