/** Representative login capability classes exercised by the generic engine. */
export const LOGIN_FIXTURE_SHAPES = [
	"oncore-combined",
	"unifi-password-only",
	"fasttrack-multistep",
	"matest-otp",
	"ambiguous-near-miss",
] as const;

/** One representative login capability class. */
export type LoginFixtureShape = (typeof LOGIN_FIXTURE_SHAPES)[number];

/**
 * Render one served login fixture without embedding behavior in the engine.
 *
 * @param shape - Capability class to expose through the page.
 * @returns Complete HTML document with a secret-free structural probe.
 *
 * @example
 * ```ts
 * const html = loginFixtureHtml("unifi-password-only")
 * ```
 */
export function loginFixtureHtml(shape: LoginFixtureShape): string {
	return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Generic login fixture</title></head>
<body data-shape="${shape}">
  <main id="app"></main>
  <script>
    const shape = ${JSON.stringify(shape)};
    const model = { username: "", password: "", otp: "" };
    let stage = "start";
    let activationCount = 0;
    const app = document.getElementById("app");

    function field(id, label, type = "text", named = true) {
      return named
        ? '<label>' + label + ' <input id="' + id + '" type="' + type + '"></label>'
        : '<input id="' + id + '" type="' + type + '">';
    }

    function wire(id, key) {
      const input = document.getElementById(id);
      if (!input) return;
      input.addEventListener("input", () => {
        model[key] = input.value;
        updateDisabled();
      });
      input.addEventListener("change", () => {
        model[key] = input.value;
        updateDisabled();
      });
    }

    function updateDisabled() {
      const button = document.querySelector("button");
      if (!button) return;
      if (shape === "oncore-combined") button.disabled = !(model.username && model.password);
      if (shape === "unifi-password-only") button.disabled = !model.password;
      if (shape === "fasttrack-multistep") button.disabled = stage === "username" ? !model.username : !model.password;
      if (shape === "matest-otp") {
        button.disabled = stage === "username" ? !model.username : stage === "password" ? !model.password : !model.otp;
      }
    }

    function done() {
      stage = "done";
      app.innerHTML = '<h1>Welcome, signed in</h1><a href="#account">My account</a>';
    }

    function activate(next) {
      activationCount += 1;
      if (next === "done") return done();
      stage = next;
      render();
    }

    function render() {
      if (shape === "oncore-combined") {
        stage = "combined";
        app.innerHTML = '<h1>Log in</h1>' + field("username", "User Name:") + field("password", "Password:", "password") + '<button type="button" disabled>Log In</button>';
        wire("username", "username"); wire("password", "password");
        document.querySelector("button").addEventListener("click", () => activate("done"));
      } else if (shape === "unifi-password-only") {
        stage = "password";
        app.innerHTML = '<h1>UniFi OS</h1>' + field("password", "Password", "password") + '<button type="button" disabled>Sign In</button>';
        wire("password", "password");
        document.querySelector("button").addEventListener("click", () => activate("done"));
      } else if (shape === "fasttrack-multistep") {
        if (stage === "start") stage = "username";
        if (stage === "username") {
          app.innerHTML = '<h1>Sign in</h1>' + field("username", "", "text", false) + '<button type="button" disabled>Next</button>';
          wire("username", "username");
          document.querySelector("button").addEventListener("click", () => activate("password"));
        } else {
          app.innerHTML = '<h1>Enter password</h1>' + field("password", "", "password", false) + '<button type="button" disabled>Continue</button>';
          wire("password", "password");
          document.querySelector("button").addEventListener("click", () => activate("done"));
        }
      } else if (shape === "matest-otp") {
        if (stage === "start") stage = "username";
        if (stage === "username") {
          app.innerHTML = '<h1>Sign in</h1>' + field("username", "Username") + '<button type="button" disabled>Next</button>';
          wire("username", "username");
          document.querySelector("button").addEventListener("click", () => activate("password"));
        } else if (stage === "password") {
          app.innerHTML = '<h1>Enter password</h1>' + field("password", "Password", "password") + '<button type="button" disabled>Continue</button>';
          wire("password", "password");
          document.querySelector("button").addEventListener("click", () => activate("otp"));
        } else {
          app.innerHTML = '<h1>Two-factor authentication</h1>' + field("otp", "One-time code") + '<button type="button" disabled>Verify</button>';
          wire("otp", "otp");
          document.querySelector("button").addEventListener("click", () => activate("done"));
        }
      } else {
        stage = "ambiguous";
        app.innerHTML = '<h1>Continue</h1><input id="field-a"><input id="field-b"><button type="button">Next</button>';
      }
      updateDisabled();
    }

    window.__probe = () => ({
      shape,
      stage,
      committed: {
        username: model.username.length > 0,
        password: model.password.length > 0,
        otp: model.otp.length > 0,
      },
      activationCount,
      signedIn: stage === "done",
    });
    render();
  </script>
</body>
</html>`;
}
