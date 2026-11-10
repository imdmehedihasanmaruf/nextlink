'use strict';

/**
 * Check whether the currency symbol survives a GSM 7-bit encode, which is
 * what almost every SMS gateway uses for the 160 character segment.
 *
 * The Bengali Taka sign (৳, U+09F3) is not part of GSM 7-bit, so a message
 * containing it falls back to UCS-2 and costs more segments — or is
 * rejected outright by some gateways.
 */

const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";

const symbol = '৳';

console.log('Taka sign in the GSM 7-bit set:', GSM_BASIC.includes(symbol));
console.log('Character code point:', `U+${symbol.codePointAt(0).toString(16).toUpperCase()}`);
console.log('ASCII fallback "BDT" is safe:', ['B', 'D', 'T'].every((c) => GSM_BASIC.includes(c)));
console.log('');
console.log('Conclusion: the symbol is not GSM 7-bit safe.');
console.log('Use BILLING_CURRENCY_SYMBOL=BDT for SMS messages, or keep the symbol');
console.log('only in the PDF invoice and the web UI.');
