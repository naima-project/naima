// The version of the plugin contract: the shape of a manifest, and of what
// the core hands a plugin (docs/reference/plugin-contract.md#the-contract-version).

/**
 * The contract this core speaks. A plugin says the contract it was written
 * for in its manifest's `contract`; one written for a newer contract is
 * refused when the project loads, and one that says none is read as
 * contract 1, the shape before `contract` existed.
 */
export const CONTRACT = 3

/** The oldest contract this core still reads: a plugin written for it keeps working through the shims the contract lists. */
export const OLDEST_CONTRACT = 1
