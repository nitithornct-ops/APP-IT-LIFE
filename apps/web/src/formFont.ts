import { FORM_FONT_CSS } from '@itlife/shared';

/** Load the bundled Thai font before the app renders so UI and document metrics match. */
if (typeof document !== 'undefined' && !document.head.querySelector('style[data-form-font]')) {
  const style = document.createElement('style');
  style.dataset.formFont = 'true';
  style.textContent = FORM_FONT_CSS;
  document.head.append(style);
}

export { FORM_FONT_CSS };
