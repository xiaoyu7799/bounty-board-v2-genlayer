import { abi } from 'genlayer-js';

// A successful transaction can still contain a rejected payable operation.
export function decodeWriteReturn(encoded) {
  if (typeof encoded !== 'string') throw Error('MISSING_CONTRACT_RETURN');
  const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  if (bytes[0] !== 0) throw Error('INVALID_CONTRACT_RETURN');
  const value = JSON.parse(abi.calldata.decode(bytes.slice(1)));
  if (!value || typeof value.accepted !== 'boolean') throw Error('INVALID_CONTRACT_RETURN');
  return value;
}
