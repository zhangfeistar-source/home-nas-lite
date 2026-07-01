(function () {
  "use strict";

  const form = document.getElementById("login-form");
  const input = document.getElementById("access-code");
  const submitButton = document.getElementById("login-button");
  const errorMessage = document.getElementById("login-error");
  const toggleButton = document.getElementById("toggle-code");

  async function checkSession() {
    try {
      const data = await NasApi.json("/api/auth/me");
      if (data.authenticated) {
        window.location.replace("./index.html");
      }
    } catch (error) {
      if (error.status !== 401 && error.status !== 0) {
        errorMessage.textContent = error.message;
      }
    }
  }

  toggleButton.addEventListener("click", function () {
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    toggleButton.setAttribute("aria-pressed", String(!showing));
    toggleButton.setAttribute("aria-label", showing ? "显示访问码" : "隐藏访问码");
    toggleButton.querySelector("span").textContent = showing ? "查看" : "隐藏";
    input.focus();
  });

  input.addEventListener("input", function () {
    errorMessage.textContent = "";
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    const accessCode = input.value;
    if (!accessCode) {
      errorMessage.textContent = "请输入家庭访问码。";
      input.focus();
      return;
    }

    submitButton.disabled = true;
    submitButton.classList.add("is-loading");
    errorMessage.textContent = "";
    try {
      await NasApi.json("/api/auth/login", {
        method: "POST",
        body: { accessCode }
      });
      window.location.replace("./index.html");
    } catch (error) {
      errorMessage.textContent = error.status === 401 ? "访问码不正确，请重新输入。" : error.message;
      input.select();
    } finally {
      submitButton.disabled = false;
      submitButton.classList.remove("is-loading");
    }
  });

  checkSession();
}());
