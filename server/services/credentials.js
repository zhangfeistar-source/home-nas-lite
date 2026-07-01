'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { ApiError } = require('../../shared/api-error');

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;

function hashCredentialSync(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ApiError(400, '密码不能为空');
  }

  const salt = crypto.randomBytes(16);
  const derivedKey = crypto.scryptSync(value, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

function normalizeStoredCredential(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    const parts = value.split('$');
    if (parts.length === 3 && parts[0] === 'scrypt') {
      return { salt: parts[1], hash: parts[2] };
    }
    return null;
  }

  if (typeof value === 'object' && value.salt && (value.hash || value.derivedKey)) {
    return {
      salt: value.salt,
      hash: value.hash || value.derivedKey
    };
  }

  return null;
}

async function verifyCredential(value, storedCredential) {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }

  const normalized = normalizeStoredCredential(storedCredential);
  if (!normalized || !/^[a-f\d]+$/i.test(normalized.salt) || !/^[a-f\d]+$/i.test(normalized.hash)) {
    return false;
  }

  const expected = Buffer.from(normalized.hash, 'hex');
  if (expected.length === 0) {
    return false;
  }

  const actual = await scrypt(value, Buffer.from(normalized.salt, 'hex'), expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function resolveCredential(storedCredential, plainTextOption) {
  if (normalizeStoredCredential(storedCredential)) {
    return storedCredential;
  }
  if (typeof plainTextOption === 'string' && plainTextOption.length > 0) {
    return hashCredentialSync(plainTextOption);
  }
  return null;
}

module.exports = {
  hashCredentialSync,
  normalizeStoredCredential,
  resolveCredential,
  verifyCredential
};
