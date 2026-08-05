/** Auth-route fixture shapes: one that authenticates, one that stays ambiguous. */
export const AUTH_ROUTE_SHAPES = [
	"multistep-then-business",
	"ambiguous-near-miss",
] as const;

/** One served auth-route fixture class. */
export type AuthRouteShape = (typeof AUTH_ROUTE_SHAPES)[number];

/**
 * Render one served auth-route fixture.
 *
 * The page carries a login surface (multistep username→password, or an
 * ambiguous unlabelled near-miss) plus a business surface whose counter only
 * moves when a business step runs. The engine authenticates; the throwaway
 * runbook glue dispatches the business step afterwards. The probe reports both
 * the login commit state and the business counter so the spike can assert
 * ordering (counter stays 0 before auth, becomes exactly 1 after).
 *
 * @param shape - Fixture class to expose.
 * @returns Complete HTML document with a secret-free structural probe.
 *
 * @example
 * ```ts
 * const html = authRouteFixtureHtml("multistep-then-business")
 * ```
 */
export function authRouteFixtureHtml(shape: AuthRouteShape): string {
	return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Auth-route fixture</title></head>
<body data-shape="${shape}">
  <main id="app"></main>
  <script>
    const shape = ${JSON.stringify(shape)};
    const model = { username: "", password: "" };
    let stage = "start";
    let activationCount = 0;
    let businessCount = 0;
    const app = document.getElementById("app");

    function field(id, label, type, named) {
      return named
        ? '<label>' + label + ' <input id="' + id + '" type="' + type + '"></label>'
        : '<input id="' + id + '" type="' + type + '">';
    }

    function wire(id, key) {
      const input = document.getElementById(id);
      if (!input) return;
      const commit = () => { model[key] = input.value; updateDisabled(); };
      input.addEventListener("input", commit);
      input.addEventListener("change", commit);
    }

    function updateDisabled() {
      const button = document.querySelector("button");
      if (!button) return;
      if (shape === "multistep-then-business") {
        button.disabled = stage === "username" ? !model.username : !model.password;
      }
    }

    // Business surface exposed only after authentication. The business step is a
    // deliberate marker: a labelled control the throwaway glue clicks post-auth.
    function signedIn() {
      stage = "signed-in";
      app.innerHTML =
        '<h1>Welcome, signed in</h1>' +
        '<button id="run-business" type="button">Submit timesheet</button>' +
        '<p id="business-status">business: pending</p>';
      const runButton = document.getElementById("run-business");
      runButton.addEventListener("click", () => {
        businessCount += 1;
        document.getElementById("business-status").textContent = "business: done";
      });
    }

    function activate(next) {
      activationCount += 1;
      if (next === "signed-in") return signedIn();
      stage = next;
      render();
    }

    function render() {
      if (shape === "multistep-then-business") {
        if (stage === "start") stage = "username";
        if (stage === "username") {
          app.innerHTML = '<h1>Sign in</h1>' + field("username", "Username", "text", true) + '<button type="button" disabled>Next</button>';
          wire("username", "username");
          document.querySelector("button").addEventListener("click", () => activate("password"));
        } else {
          app.innerHTML = '<h1>Enter password</h1>' + field("password", "Password", "password", true) + '<button type="button" disabled>Continue</button>';
          wire("password", "password");
          document.querySelector("button").addEventListener("click", () => activate("signed-in"));
        }
      } else {
        // Ambiguous near-miss: two unlabelled fields, no committable login shape.
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
      },
      activationCount,
      businessCount,
      signedIn: stage === "signed-in",
    });
    render();
  </script>
</body>
</html>`;
}
