'use strict';

class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function assertApi(condition, status, message, code) {
  if (!condition) {
    throw new ApiError(status, message, code);
  }
}

module.exports = {
  ApiError,
  assertApi
};
