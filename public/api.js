(function () {
  "use strict";

  class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.data = data;
    }
  }

  function buildUrl(path, query) {
    const url = new URL(path, window.location.origin);
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    });
    return url.pathname + url.search;
  }

  async function request(path, options) {
    const requestOptions = Object.assign({ credentials: "same-origin" }, options);
    if (requestOptions.body && !(requestOptions.body instanceof FormData) && typeof requestOptions.body !== "string") {
      requestOptions.headers = Object.assign({ "Content-Type": "application/json" }, requestOptions.headers);
      requestOptions.body = JSON.stringify(requestOptions.body);
    }

    let response;
    try {
      response = await fetch(path, requestOptions);
    } catch (error) {
      throw new ApiError("无法连接到家庭 NAS，请检查网络后重试。", 0, null);
    }

    const contentType = response.headers.get("content-type") || "";
    let data = null;
    if (contentType.includes("application/json")) {
      try {
        data = await response.json();
      } catch (error) {
        data = null;
      }
    }

    if (!response.ok || (data && data.ok === false)) {
      const message = data && data.message ? data.message : statusMessage(response.status);
      throw new ApiError(message, response.status, data);
    }
    return { response, data };
  }

  function statusMessage(status) {
    const messages = {
      400: "请求内容有误，请检查后重试。",
      401: "登录已失效，请重新登录。",
      403: "管理员验证失败。",
      404: "文件或文件夹不存在。",
      409: "目标位置存在同名项目。",
      413: "上传文件过大。",
      416: "媒体范围请求无效。",
      500: "服务器内部错误，请稍后重试。"
    };
    return messages[status] || "操作失败，请稍后重试。";
  }

  async function json(path, options) {
    const result = await request(path, options);
    return result.data || { ok: true };
  }

  async function blob(path, options) {
    const result = await request(path, options);
    return {
      blob: await result.response.blob(),
      filename: filenameFromResponse(result.response)
    };
  }

  function filenameFromResponse(response) {
    const disposition = response.headers.get("content-disposition") || "";
    const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utfMatch) {
      try {
        return decodeURIComponent(utfMatch[1]);
      } catch (error) {
        return utfMatch[1];
      }
    }
    const basicMatch = disposition.match(/filename="?([^";]+)"?/i);
    return basicMatch ? basicMatch[1] : "";
  }

  window.NasApi = {
    ApiError,
    blob,
    buildUrl,
    json,
    request
  };
}());
