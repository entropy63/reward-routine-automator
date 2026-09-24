// Typing search queries inside the Bing page. This file's one export is
// handed to chrome.scripting.executeScript({ func }) — which serializes the
// function's SOURCE and runs it in the page — so it must stay entirely
// self-contained: no imports, no closure references, nothing outside its own
// body. It is ported verbatim from src/background.js for that reason; any
// change here needs the same caution the original needed.
//
// Resolves with the real elapsed typing time plus the pre-submit pause, and
// resolves *before* submitting so the pending navigation can't kill the reply.
export function performHumanTypedSearchOnBing(query) {
  return new Promise(resolve => {
    const input =
      document.querySelector("#sb_form_q") ||
      document.querySelector('input[name="q"]') ||
      document.querySelector('input[type="search"]');

    if (!input) {
      console.warn("Bing search input not found.");
      resolve(0);
      return;
    }

    const form = document.querySelector("#sb_form") || input.form;
    const button =
      document.querySelector("#sb_form_go") ||
      (form && form.querySelector('input[type="submit"], button'));

    // Assigning .value directly bypasses the property setter that page
    // frameworks hook, so the suggestion UI never sees the input.
    const nativeValue = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input),
      "value"
    );
    const setValue = v => {
      if (nativeValue && nativeValue.set) nativeValue.set.call(input, v);
      else input.value = v;
    };

    function fireKey(type, ch) {
      input.dispatchEvent(
        new KeyboardEvent(type, {
          key: ch,
          bubbles: true,
          cancelable: true,
          composed: true
        })
      );
    }

    function submit() {
      if (button) {
        button.click();
      } else if (form) {
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        else form.submit();
      } else {
        input.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
            composed: true
          })
        );
      }
    }

    function randomCharDelay() {
      const base = 80 + Math.random() * 180;
      const longPause = Math.random() < 0.08 ? 200 + Math.random() * 400 : 0;
      return base + longPause;
    }

    setValue("");
    input.focus();

    const startedAt = performance.now();
    let idx = 0;

    function typeNextChar() {
      if (idx >= query.length) {
        const preSubmitPause = 400 + Math.random() * 800;
        const typedMs = performance.now() - startedAt;

        setTimeout(submit, preSubmitPause);
        resolve(typedMs + preSubmitPause);
        return;
      }

      const ch = query[idx++];

      fireKey("keydown", ch);
      fireKey("keypress", ch);
      setValue(input.value + ch);
      input.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          composed: true,
          inputType: "insertText",
          data: ch
        })
      );
      fireKey("keyup", ch);

      setTimeout(typeNextChar, randomCharDelay());
    }

    typeNextChar();
  });
}
