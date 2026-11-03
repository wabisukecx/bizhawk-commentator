export const SERVICE_VERSION = '0.3.0';

// 0.3.0 adds ZIP preparation; protocol 1 and the observation RPCs are unchanged
// from 0.2.2. The connecting client prepares packs even when an older broker is reused.
export const COMPATIBLE_SERVICE_VERSIONS = Object.freeze(['0.2.2', SERVICE_VERSION]);
