import {z} from 'zod';
import type {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {Config} from './types.js';
import {makePeopleApiCall} from '../utils/contacts-api.js';
import {jsonResult} from '../utils/response.js';
import {strictSchemaWithAliases} from '../utils/schema.js';
import {computeDiff, displayName, extractFields, isDryRun, writeJournalEntry} from '../utils/guardrail.js';

const inputSchema = strictSchemaWithAliases({
	givenName: z.string().optional().describe('First name'),
	familyName: z.string().optional().describe('Last name'),
	emailAddresses: z.array(z.object({
		value: z.string().describe('Email address'),
		type: z.string().optional().describe('Type of email. Predefined values are "home", "work", or "other"; any other string is treated as a custom label.'),
	})).optional().describe('Email addresses'),
	phoneNumbers: z.array(z.object({
		value: z.string().describe('Phone number'),
		type: z.string().optional().describe('Type of phone. Predefined values are "home", "work", "mobile", "homeFax", "workFax", "otherFax", "pager", "workMobile", "workPager", "main", "googleVoice", or "other"; any other string is treated as a custom label.'),
	})).optional().describe('Phone numbers'),
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

export function registerContactCreate(server: McpServer, config: Config): void {
	server.registerTool(
		'contact_create',
		{
			title: 'Create contact',
			description: 'Create a new contact in Google Contacts.',
			inputSchema,
			outputSchema,
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: false,
			},
		},
		async ({givenName, familyName, emailAddresses, phoneNumbers, organization, jobTitle, notes}) => {
			const person: Record<string, unknown> = {};

			if (givenName || familyName) {
				person.names = [{givenName, familyName}];
			}

			if (emailAddresses?.length) {
				person.emailAddresses = emailAddresses;
			}

			if (phoneNumbers?.length) {
				person.phoneNumbers = phoneNumbers;
			}

			if (organization || jobTitle) {
				person.organizations = [{name: organization, title: jobTitle}];
			}

			if (notes) {
				person.biographies = [{value: notes, contentType: 'TEXT_PLAIN'}];
			}

			// Guardrail: diff (create → all provided fields) + journal + dry-run.
			const after = {
				givenName: givenName ?? '',
				familyName: familyName ?? '',
				emails: (emailAddresses ?? []).map((e: {value: string}) => e.value).filter(Boolean).join(', '),
				phones: (phoneNumbers ?? []).map((p: {value: string}) => p.value).filter(Boolean).join(', '),
				organization: organization ?? '',
				jobTitle: jobTitle ?? '',
				notes: notes ?? '',
			};
			const diff = computeDiff(extractFields(undefined), after);
			const name = displayName(after);

			if (isDryRun()) {
				writeJournalEntry({op: 'contact_create', status: 'DRY-RUN', name, diff});
				return jsonResult({resourceName: '(dry-run)', dryRun: true, message: `DRY-RUN : contact "${name}" NON créé (diff journalisé)`, diff});
			}

			try {
				const result = await makePeopleApiCall('POST', '/people:createContact', config.token, person);
				const parsed = outputSchema.parse(result);
				writeJournalEntry({op: 'contact_create', status: 'OK', name, resourceName: parsed.resourceName, diff});
				return jsonResult(parsed);
			} catch (error) {
				writeJournalEntry({op: 'contact_create', status: 'ÉCHEC', name, diff});
				throw error;
			}
		},
	);
}
