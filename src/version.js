export const SERVICE_VERSION = '0.4.0';

// ZIP preparation and generic game logs keep protocol 1 and its observation RPCs.
// Older brokers preserve the added fields. The connecting client prepares pack registrations.
export const COMPATIBLE_SERVICE_VERSIONS = Object.freeze(['0.2.2', '0.3.0', SERVICE_VERSION]);
