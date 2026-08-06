/** Test-only legacy action bytes used to prove content-addressed behavior. */
export const ONCORE_DRAFT_VERIFICATION_ACTION_BYTES =
	"async ({ inputs }) => JSON.parse(document.querySelector('#draft-proof').textContent)";

/** Test evaluator for the legacy draft-proof behavior. Never imported by runtime code. */
export const ONCORE_DRAFT_VERIFICATION_EVALUATOR_FIXTURE =
	`async ({ inputs }) => {
		const raw = document.querySelector('#draft-proof')?.textContent;
		let proof;
		try {
			proof = JSON.parse(raw ?? '');
		} catch {
			throw new Error('draft verification failed');
		}
		const expectedKeys = inputs.item_keys;
		const expectedTotal = inputs.entries.reduce((total, entry) => total + entry.units, 0);
		const exactShape =
			proof !== null &&
			typeof proof === 'object' &&
			!Array.isArray(proof) &&
			Object.keys(proof).sort().join(',') === 'editable,persisted_entries,submitted,total_units';
		const orderedKeysMatch =
			Array.isArray(proof?.persisted_entries) &&
			proof.persisted_entries.length === expectedKeys.length &&
			proof.persisted_entries.every((key, index) => key === expectedKeys[index]);
		const valid =
			exactShape &&
			orderedKeysMatch &&
			proof.total_units === expectedTotal &&
			proof.editable === true &&
			proof.submitted === false;
		if (!valid) throw new Error('draft verification failed');
		return { verification: 'oncore-draft-preserved-v1' };
	}`;
