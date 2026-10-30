// lib/codice-fiscale.js
//
// Round 68 — light check of an Italian codice fiscale (persona fisica):
// shape (with omocodia substitutions) plus the official check character.
// It does not match the code against the person's name or birth date.
// Shared by the guest app, the host console and api/guest.js, using the
// same IIFE + module.exports pattern as lib/alloggiati-records.js.

(function (root) {
  'use strict';

  // Odd-position values (1st, 3rd, ... character) from the official table.
  // Digits map like the letter in the same position (0→A, 1→B, ...).
  var ODD = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23];
  var OMOCODIA = 'LMNPQRSTUV';
  var D = '[0-9' + OMOCODIA + ']';
  var SHAPE = new RegExp('^[A-Z]{6}' + D + D + '[ABCDEHLMPRST]' + D + D + '[A-Z]' + D + D + D + '[A-Z]$');

  function charIndex(c) {
    return c >= '0' && c <= '9' ? c.charCodeAt(0) - 48 : c.charCodeAt(0) - 65;
  }

  function normalize(value) {
    return String(value == null ? '' : value).replace(/\s+/g, '').toUpperCase();
  }

  // Check character for the first 15 characters (already normalised).
  function checkChar(first15) {
    var sum = 0;
    for (var i = 0; i < 15; i++) {
      var n = charIndex(first15.charAt(i));
      sum += i % 2 === 0 ? ODD[n] : n;
    }
    return String.fromCharCode(65 + (sum % 26));
  }

  function isValid(value) {
    var cf = normalize(value);
    if (!SHAPE.test(cf)) return false;
    return checkChar(cf.slice(0, 15)) === cf.charAt(15);
  }

  var api = { normalize: normalize, checkChar: checkChar, isValid: isValid };
  root.CodiceFiscale = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
