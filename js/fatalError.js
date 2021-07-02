import { translate } from './translate.js';

export function fatalError(title, innerHTML) {
  document.body.innerHTML = `<h3 style="text-align: center;">${title} :(</h3>` + innerHTML;
  throw new Error("fatal error: " + title);
}
