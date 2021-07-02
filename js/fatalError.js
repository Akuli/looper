import { translate } from './translate.js';

export function fatalError(title, innerHTML) {
  document.body.innerHTML = `<h3 style="text-align: center;">${title} :(</h3>` + innerHTML;
  throw new Error("fatal error: " + title);
}

export function checkBrowser() {
  // TODO: make it actually work on firefox
  if (navigator.userAgent.includes("Firefox")) {
    fatalError(
      translate("Firefox is not supported"),
      translate("Looper doesn't support Firefox yet. See issue #2.")
        .replace("#2", `<a href="https://github.com/Akuli/looper/issues/2">#2</a>`)
    );
  }
  console.log("This is not Firefox");
}
