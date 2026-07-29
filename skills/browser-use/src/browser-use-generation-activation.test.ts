import { describe, expect, test } from "bun:test";
import {
	CORPUS_GENERATION_CANDIDATE_MANIFEST_PATH,
	readActiveCorpusManifest,
	readRetainedCorpusGenerationManifest,
	tripActiveGenerationEffectFence,
	validateBrowserUseGenerationCandidateClosure,
	validateBrowserUseGenerationCandidateForMigrationState,
} from "./browser-use-generation-activation";
import {
	CORPUS_GENERATION_CANDIDATE_MANIFEST_PATH as COMPAT_CANDIDATE_PATH,
	readActiveCorpusManifest as compatReadActiveCorpusManifest,
	readRetainedCorpusGenerationManifest as compatReadRetainedCorpusGenerationManifest,
	tripActiveGenerationEffectFence as compatTripActiveGenerationEffectFence,
	validateBrowserUseGenerationCandidateClosure as compatValidateBrowserUseGenerationCandidateClosure,
	validateBrowserUseGenerationCandidateForMigrationState as compatValidateBrowserUseGenerationCandidateForMigrationState,
} from "./browser-use-migration";

describe("Corpus Generation activation owner", () => {
	test("preserves the migration compatibility surface", () => {
		expect(CORPUS_GENERATION_CANDIDATE_MANIFEST_PATH).toBe(
			"corpus-generation-candidate.json",
		);
		expect(COMPAT_CANDIDATE_PATH).toBe(
			CORPUS_GENERATION_CANDIDATE_MANIFEST_PATH,
		);
		expect(compatReadActiveCorpusManifest).toBe(readActiveCorpusManifest);
		expect(compatReadRetainedCorpusGenerationManifest).toBe(
			readRetainedCorpusGenerationManifest,
		);
		expect(compatTripActiveGenerationEffectFence).toBe(
			tripActiveGenerationEffectFence,
		);
		expect(compatValidateBrowserUseGenerationCandidateClosure).toBe(
			validateBrowserUseGenerationCandidateClosure,
		);
		expect(compatValidateBrowserUseGenerationCandidateForMigrationState).toBe(
			validateBrowserUseGenerationCandidateForMigrationState,
		);
	});
});
