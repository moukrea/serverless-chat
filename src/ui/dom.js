/**
 * DOM manipulation helpers
 */

export const $ = id => document.getElementById(id);

export const show = element => {
  if (typeof element === 'string') element = $(element);
  if (element) element.classList.remove('hidden');
};

export const hide = element => {
  if (typeof element === 'string') element = $(element);
  if (element) element.classList.add('hidden');
};

export const setText = (element, text) => {
  if (typeof element === 'string') element = $(element);
  if (element) element.textContent = text;
};

export const setHTML = (element, html) => {
  if (typeof element === 'string') element = $(element);
  if (element) element.innerHTML = html;
};

export const addClass = (element, className) => {
  if (typeof element === 'string') element = $(element);
  if (element) element.classList.add(className);
};

export const removeClass = (element, className) => {
  if (typeof element === 'string') element = $(element);
  if (element) element.classList.remove(className);
};

export const getValue = element => {
  if (typeof element === 'string') element = $(element);
  return element ? element.value : '';
};

export const setValue = (element, value) => {
  if (typeof element === 'string') element = $(element);
  if (element) element.value = value;
};

export const clearValue = element => {
  if (typeof element === 'string') element = $(element);
  if (element) element.value = '';
};
